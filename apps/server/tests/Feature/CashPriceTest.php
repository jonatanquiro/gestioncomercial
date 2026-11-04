<?php

namespace Tests\Feature;

use Tests\Support\ApiClient;
use Tests\TestCase;

/** Precio de contado (ADR 0023): con medios de contado, toda la venta a ese precio; con otro, a precio de lista. */
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

    public function test_la_lista_depende_de_todos_los_medios(): void
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
        $this->assertSame(['cash', '1800.00', '900.00', '200.00'], [$sale->body['priceList'], $sale->body['total'], $sale->body['lines'][0]['unitPrice'], $sale->body['changeGiven']]);

        // Con débito, aunque sea una parte, toda la venta va a precio de lista.
        $mixed = $this->sell($owner, $shop, $p['variantId'], '1800.00', [self::pay($cash, '900'), self::pay($debit, '900')]);
        $this->assertSame(['PRICE_CHANGED', 'list', '2000.00'], [$mixed->body['code'], $mixed->body['details']['priceList'], $mixed->body['details']['total']]);
        $this->assertSame('900.00', $mixed->body['details']['prices'][0]['cashPrice']);
        $ok = $this->sell($owner, $shop, $p['variantId'], '2000.00', [self::pay($cash, '1000'), self::pay($debit, '1000')]);
        $this->assertSame(['list', '1000.00'], [$ok->body['priceList'], $ok->body['lines'][0]['unitPrice']]);

        // El comercio marca la transferencia como contado.
        $update = $owner->put("/payment-methods/{$transfer['id']}", ['name' => $transfer['name'], 'kind' => 'transfer', 'requiresReference' => false, 'cashPrice' => true, 'active' => true, 'sortOrder' => $transfer['sortOrder']]);
        $this->assertSame(200, $update->status, json_encode($update->body));
        $t = $this->sell($owner, $shop, $p['variantId'], '1800.00', [self::pay($transfer, '1800')]);
        $this->assertSame('cash', $t->body['priceList'] ?? json_encode($t->body));
    }

    public function test_cuenta_corriente_va_a_precio_de_lista(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '1000', 'cashPrice' => '900', 'initialStock' => '10']);
        $customer = $owner->post('/customers', ['name' => 'Ana', 'documentType' => null, 'documentNumber' => null, 'vatCondition' => 5, 'creditLimit' => '5000'])->body;
        $sale = $this->sell($owner, $shop, $p['variantId'], '2000.00', [], ['customerId' => $customer['id'], 'accountAmount' => '2000']);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame('list', $sale->body['priceList']);
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
