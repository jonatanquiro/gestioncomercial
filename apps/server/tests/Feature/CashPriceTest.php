<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Precio de contado (ADR 0023 y 0029): efectivo a contado, otros medios con recargo proporcional y cuenta corriente con plazo. */
class CashPriceTest extends TestCase
{
    private function shop(): array
    {
        $t = $this->registerTenant();
        $register = $t['client']->get('/registers')->body[0];
        $this->assertSame(201, $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '1000'])->status);
        $methods = collect($t['client']->get('/payment-methods')->body)->keyBy('kind')->all();

        return $t + ['register' => $register, 'methods' => $methods];
    }

    private function sell(ApiClient $client, array $shop, string $variantId, string $expected, array $payments, array $extra = [])
    {
        return $client->post('/sales', $extra + [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'],
            'lines' => [['variantId' => $variantId, 'quantity' => '2']], 'payments' => $payments, 'expectedTotal' => $expected,
        ]);
    }

    private static function pay(array $method, string $amount): array
    {
        return ['paymentMethodId' => $method['id'], 'amount' => $amount, 'reference' => $method['requiresReference'] ? '123' : null];
    }

    public function test_alta_y_validacion_del_precio_de_contado(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $bad = $owner->post('/products', self::productInput(['price' => '1000', 'cashPrice' => '1100']));
        $this->assertSame(['variants.0.cashPrice', 'El precio de contado no puede ser mayor que el de lista'], [$bad->body['details'][0]['path'], $bad->body['details'][0]['message']]);
        $this->assertNull($this->createProduct($owner, ['price' => '1000', 'cashPrice' => '1000'])['variants'][0]['cashPrice']);
        $p = $this->createProduct($owner, ['price' => '1000', 'cashPrice' => '900']);
        $this->assertSame('900.00', $p['variants'][0]['cashPrice']);
        $code = $p['variants'][0]['barcodes'][0]['code'];
        $this->assertSame(['1000.00', '900.00'], array_values(array_intersect_key($owner->get("/products/lookup?code={$code}")->body['item'], array_flip(['price', 'cashPrice']))));
    }

    public function test_pago_mixto_proporcional(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        ['cash' => $cash, 'debit' => $debit, 'transfer' => $transfer] = $shop['methods'];
        $this->assertSame([true, false, false], [$cash['cashPrice'], $debit['cashPrice'], $transfer['cashPrice']]);
        $p = $this->createProduct($owner, ['price' => '1000', 'cashPrice' => '900', 'initialStock' => '50']);
        $line = [['variantId' => $p['variantId'], 'quantity' => '2']];
        $this->assertSame('1800.00', $owner->post('/sales/quote', ['lines' => $line, 'priceList' => 'cash'])->body['total']);
        $this->assertSame('2000.00', $owner->post('/sales/quote', ['lines' => $line])->body['total']);

        // Todo en efectivo: precio de contado.
        $sale = $this->sell($owner, $shop, $p['variantId'], '1800.00', [self::pay($cash, '2000')]);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame(['cash', '1800.00', '900.00', '200.00', '2000.00'], [$sale->body['priceList'], $sale->body['total'], $sale->body['lines'][0]['unitPrice'], $sale->body['changeGiven'], $sale->body['listTotal']]);

        // Todo con débito: precio de lista.
        $list = $this->sell($owner, $shop, $p['variantId'], '2000.00', [self::pay($debit, '2000')]);
        $this->assertSame(['list', '1000.00', '0.00'], [$list->body['priceList'], $list->body['lines'][0]['unitPrice'], $list->body['surchargeTotal']]);

        // Mitad en efectivo (900 cubre 900 de contado) y el resto con débito: 1000, que cubre 900 a contado más 100 de recargo.
        $wrong = $this->sell($owner, $shop, $p['variantId'], '1800.00', [self::pay($cash, '900'), self::pay($debit, '1000')]);
        $this->assertSame(['PRICE_CHANGED', 'mixed', '1900.00'], [$wrong->body['code'], $wrong->body['details']['priceList'], $wrong->body['details']['total']]);
        $mixed = $this->sell($owner, $shop, $p['variantId'], '1900.00', [self::pay($cash, '900'), self::pay($debit, '1000')]);
        $this->assertSame(201, $mixed->status, json_encode($mixed->body));
        $this->assertSame(['mixed', '1900.00', '100.00', '900.00', '100.00', '1900.00'], [
            $mixed->body['priceList'], $mixed->body['total'], $mixed->body['surchargeTotal'], $mixed->body['lines'][0]['unitPrice'], $mixed->body['lines'][0]['surchargeAmount'], $mixed->body['lines'][0]['total'],
        ]);
        // Si con el débito se paga de más, no hay vuelto con tarjeta.
        $over = $this->sell($owner, $shop, $p['variantId'], '2010.00', [self::pay($cash, '100'), self::pay($debit, '2100')]);
        $this->assertSame('VALIDATION_ERROR', $over->body['code'] ?? json_encode($over->body));

        // El comercio marca la transferencia como contado.
        $update = $owner->put("/payment-methods/{$transfer['id']}", ['name' => $transfer['name'], 'kind' => 'transfer', 'requiresReference' => false, 'cashPrice' => true, 'active' => true, 'sortOrder' => $transfer['sortOrder']]);
        $this->assertSame(200, $update->status, json_encode($update->body));
        $t = $this->sell($owner, $shop, $p['variantId'], '1800.00', [self::pay($transfer, '1800')]);
        $this->assertSame('cash', $t->body['priceList'] ?? json_encode($t->body));
    }

    public function test_cuenta_corriente_a_contado_con_plazo(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '1000', 'cashPrice' => '900', 'initialStock' => '10']);
        $customer = $owner->post('/customers', ['name' => 'Ana', 'documentType' => null, 'documentNumber' => null, 'vatCondition' => 5, 'creditLimit' => '5000'])->body;
        $collect = fn (string $amount) => $owner->post("/customers/{$customer['id']}/payments", ['clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'amount' => $amount, 'payments' => [self::pay($shop['methods']['cash'], $amount)]]);

        // Contado 1800 / lista 2000: entrega 1000 y deja 800 a cuenta, a precio de contado por 7 días.
        $sale = $this->sell($owner, $shop, $p['variantId'], '1800.00', [self::pay($shop['methods']['cash'], '1000')], ['customerId' => $customer['id'], 'accountAmount' => '800']);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame(['cash', '1800.00'], [$sale->body['priceList'], $sale->body['total']]);
        $term = $sale->body['accountTerm'];
        $this->assertSame([now('America/Buenos_Aires')->addDays(7)->toDateString(), '800.00', '800.00', '200.00', 'open'], [$term['dueOn'], $term['amount'], $term['pending'], $term['lateSurcharge'], $term['status']]);

        // Paga 300 dentro del plazo: le quedan 500 a contado.
        $this->assertSame(201, $collect('300')->status);
        $detail = $owner->get("/customers/{$customer['id']}")->body;
        $this->assertSame(['500.00', '500.00'], [$detail['balance'], $detail['terms'][0]['pending']]);

        // Vence sin pagar el resto: toda la venta pasa a lista. Debe 2000 − 1300 pagados = 700.
        DB::table('account_terms')->where('sale_id', $sale->body['id'])->update(['due_on' => now('America/Buenos_Aires')->subDay()->toDateString()]);
        $detail = $owner->get("/customers/{$customer['id']}")->body;
        $this->assertSame(['700.00', []], [$detail['balance'], $detail['terms']]);
        $this->assertSame(['surcharge', '200.00'], [$detail['movements'][0]['kind'], $detail['movements'][0]['amount']]);
        $this->assertSame('700.00', $owner->get("/customers/{$customer['id']}")->body['balance'], 'el recargo se aplica una sola vez');
        $this->assertSame(['surcharged', '200.00'], [$owner->get("/sales/{$sale->body['id']}")->body['accountTerm']['status'], $owner->get("/sales/{$sale->body['id']}")->body['accountTerm']['surchargeApplied']]);

        // Si paga todo a tiempo, no hay recargo.
        $this->assertSame(201, $collect('700')->status);
        $again = $this->sell($owner, $shop, $p['variantId'], '1800.00', [], ['customerId' => $customer['id'], 'accountAmount' => '1800']);
        $this->assertSame(201, $again->status, json_encode($again->body));
        $this->assertSame(201, $collect('1800')->status);
        DB::table('account_terms')->where('sale_id', $again->body['id'])->update(['due_on' => now('America/Buenos_Aires')->subDay()->toDateString()]);
        $this->assertSame('0.00', $owner->get("/customers/{$customer['id']}")->body['balance']);
        $this->assertSame('paid', $owner->get("/sales/{$again->body['id']}")->body['accountTerm']['status']);

        // Sin plazo (0 días), lo que va a cuenta va a precio de lista como antes.
        $tenant = $owner->get('/tenant')->body;
        $this->assertSame(200, $owner->put('/tenant', [...$tenant, 'settings' => ['accountTermDays' => 0] + $tenant['settings']])->status);
        $list = $this->sell($owner, $shop, $p['variantId'], '2000.00', [], ['customerId' => $customer['id'], 'accountAmount' => '2000']);
        $this->assertSame(['list', null], [$list->body['priceList'] ?? json_encode($list->body), $list->body['accountTerm']]);
    }

    public function test_el_cambio_masivo_mantiene_la_proporcion(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $p = $this->createProduct($owner, ['price' => '1000', 'cashPrice' => '900']);
        $body = ['scope' => ['categoryId' => null, 'brandId' => null, 'productIds' => [$p['id']]], 'rule' => ['kind' => 'percent', 'value' => '10'], 'roundingStep' => 0];
        $preview = $owner->post('/prices/bulk/preview', $body)->body;
        $this->assertSame(['1100.00', '900.00', '990.00'], [$preview['rows'][0]['newPrice'], $preview['rows'][0]['oldCashPrice'], $preview['rows'][0]['newCashPrice']]);
        $this->assertSame(200, $owner->post('/prices/bulk/apply', $body + ['fingerprint' => $preview['fingerprint']])->status);
        $this->assertSame(['1100.00', '990.00'], [$owner->get("/products/{$p['id']}")->body['variants'][0]['price'], $owner->get("/products/{$p['id']}")->body['variants'][0]['cashPrice']]);
    }

    public function test_importacion_con_precio_de_contado(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $code = '779'.random_int(1000000000, 9999999999);
        $row = ['row' => 2, 'options' => [], 'name' => 'Jean', 'barcode' => $code, 'price' => '40.000', 'cashPrice' => '36.000'];
        $this->assertSame(200, $owner->post('/products/import', ['rows' => [$row], 'optionNames' => [], 'updateExisting' => false, 'dryRun' => false])->status);
        $this->assertSame('36000.00', $owner->get("/products/lookup?code={$code}")->body['item']['cashPrice']);
        $again = $owner->post('/products/import', ['rows' => [['cashPrice' => '35.000'] + $row], 'optionNames' => [], 'updateExisting' => true, 'dryRun' => false]);
        $this->assertSame(200, $again->status, json_encode($again->body));
        $this->assertSame('35000.00', $owner->get("/products/lookup?code={$code}")->body['item']['cashPrice']);
    }
}
