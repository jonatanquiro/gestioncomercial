<?php

namespace Tests\Feature;

use App\Models\GiftCard;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Tests\Support\ApiClient;
use Tests\Support\LiveServer;
use Tests\TestCase;

/** Gift cards (ADR 0015): venta, uso en una o varias compras, vencimiento, anulación y caja. */
class GiftCardsTest extends TestCase
{
    private function shop(): array
    {
        $t = $this->registerTenant();
        $register = $t['client']->get('/registers')->body[0];
        $open = $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '1000']);
        $this->assertSame(201, $open->status, json_encode($open->body));
        $methods = collect($t['client']->get('/payment-methods')->body)->keyBy('kind')->all();

        return $t + ['register' => $register, 'shiftId' => $open->body['id'], 'methods' => $methods];
    }

    private function issue(ApiClient $client, array $shop, string $amount, array $payments, array $extra = [])
    {
        return $client->post('/gift-cards', $extra + [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'amount' => $amount, 'validMonths' => 6,
            'recipientName' => 'Ana', 'fromName' => 'Tía Marta', 'payments' => $payments,
        ]);
    }

    private function buy(ApiClient $client, array $shop, array $product, string $total, array $giftCards, array $payments = [])
    {
        return $client->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'],
            'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']],
            'payments' => $payments, 'giftCards' => $giftCards, 'expectedTotal' => $total,
        ]);
    }

    private function cash(array $shop, string $amount): array
    {
        return ['paymentMethodId' => $shop['methods']['cash']['id'], 'amount' => $amount];
    }

    public function test_se_vende_se_usa_en_varias_compras_y_no_se_cuenta_dos_veces(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];

        $res = $this->issue($owner, $shop, '30000', [$this->cash($shop, '50000')]);
        $this->assertSame(201, $res->status, json_encode($res->body));
        $card = $res->body['giftCard'];
        $this->assertMatchesRegularExpression('/^GC[A-Z2-9]{10}$/', $card['code']);
        $this->assertSame(['30000.00', '30000.00', 'active', 'Ana'], [$card['amount'], $card['balance'], $card['state'], $card['recipientName']]);
        $this->assertSame(Carbon::now('America/Buenos_Aires')->addMonthsNoOverflow(6)->toDateString(), $card['expiresOn']);
        $this->assertSame([], $res->body['lines']);
        $this->assertSame('20000.00', $res->body['changeGiven']);
        $this->assertSame('31000.00', $owner->get("/shifts/{$shop['shiftId']}")->body['expectedCash'], 'entra a la caja como cualquier venta');

        // Primera compra: paga parte con la tarjeta y el resto en efectivo.
        $remera = $this->createProduct($owner, ['name' => 'Remera', 'price' => '18000', 'initialStock' => '5']);
        $first = $this->buy($owner, $shop, $remera, '18000.00', [['code' => strtolower($card['code']), 'amount' => '10000']], [$this->cash($shop, '8000')]);
        $this->assertSame(201, $first->status, json_encode($first->body));
        $this->assertSame(['gift_card', 'cash'], array_column($first->body['payments'], 'kind'));
        $this->assertSame($card['code'], $first->body['payments'][0]['reference']);

        // Más que el saldo no.
        $campera = $this->createProduct($owner, ['name' => 'Campera', 'price' => '25000', 'initialStock' => '5']);
        $over = $this->buy($owner, $shop, $campera, '25000.00', [['code' => $card['code'], 'amount' => '25000']]);
        $this->assertSame(400, $over->status);
        $this->assertStringContainsString('tiene un saldo de $ 20.000', $over->body['details'][0]['message']);

        // Más que el total de la venta tampoco.
        $medias = $this->createProduct($owner, ['name' => 'Medias', 'price' => '3000', 'initialStock' => '5']);
        $tooMuch = $this->buy($owner, $shop, $medias, '3000.00', [['code' => $card['code'], 'amount' => '5000']]);
        $this->assertSame(400, $tooMuch->status);
        $this->assertStringContainsString('hasta el total', $tooMuch->body['details'][0]['message']);

        // Segunda compra con el resto.
        $second = $this->buy($owner, $shop, $remera, '18000.00', [['code' => $card['code'], 'amount' => '18000']]);
        $this->assertSame(201, $second->status, json_encode($second->body));
        $after = $owner->get('/gift-cards/lookup?code='.$card['code'])->body;
        $this->assertSame(['2000.00', 'active'], [$after['balance'], $after['state']]);
        $this->assertSame(['issue', 'redeem', 'redeem'], array_column($after['movements'], 'kind'));

        // El resumen del día cuenta la plata cuando entra (venta de la tarjeta), no cuando se usa.
        $today = $owner->get('/dashboard/today')->body['sales'];
        $this->assertSame('38000.00', $today['total'], 'gift card 30.000 + efectivo 8.000');
        $this->assertSame('0.00', $today['electronic']);
        // No es un cobro a rendir ni un medio para elegir.
        $this->assertNotContains('gift_card', array_column($owner->get('/payments')->body['items'], 'kind'));
        $this->assertNotContains('gift_card', array_column($owner->get('/payment-methods')->body, 'kind'));
        $giftMethod = $first->body['payments'][0]['paymentMethodId'];
        $this->assertSame(400, $this->buy($owner, $shop, $medias, '3000.00', [], [['paymentMethodId' => $giftMethod, 'amount' => '3000']])->status);

        // Listado: saldo pendiente con los clientes.
        $list = $owner->get('/gift-cards')->body;
        $this->assertSame(['count' => 1, 'amount' => '2000.00'], $list['outstanding']);
        $this->assertSame($card['code'], $list['items'][0]['code']);
        $this->assertSame(1, $owner->get('/gift-cards?state=active&q=ana')->body['total']);
        $this->assertSame(0, $owner->get('/gift-cards?state=used')->body['total']);
        $this->assertSame($card['code'], collect($owner->get('/sales')->body['items'])->firstWhere('id', $res->body['id'])['giftCardCode']);
    }

    public function test_anular_la_compra_devuelve_el_saldo_y_la_tarjeta_usada_no_se_anula(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $sale = $this->issue($owner, $shop, '5000', [$this->cash($shop, '5000')])->body;
        $code = $sale['giftCard']['code'];
        $p = $this->createProduct($owner, ['price' => '5000', 'initialStock' => '5']);

        $buy = $this->buy($owner, $shop, $p, '5000.00', [['code' => $code, 'amount' => '5000']])->body;
        $this->assertSame('used', $owner->get("/gift-cards/lookup?code={$code}")->body['state']);
        $used = $owner->post("/sales/{$sale['id']}/void", ['reason' => 'Error']);
        $this->assertSame('GIFT_CARD_USED', $used->body['code']);

        $this->assertSame(200, $owner->post("/sales/{$buy['id']}/void", ['reason' => 'Se arrepintió'])->status);
        $card = $owner->get("/gift-cards/lookup?code={$code}")->body;
        $this->assertSame(['5000.00', 'active'], [$card['balance'], $card['state']]);
        $this->assertSame('reversal', end($card['movements'])['kind']);

        // Sin usar, la venta de la tarjeta se anula y la tarjeta queda anulada.
        $cashBefore = $owner->get("/shifts/{$shop['shiftId']}")->body['expectedCash'];
        $this->assertSame(200, $owner->post("/sales/{$sale['id']}/void", ['reason' => 'Se cobró dos veces'])->status);
        $this->assertSame('voided', $owner->get("/gift-cards/lookup?code={$code}")->body['state']);
        $this->assertSame(number_format((float) $cashBefore - 5000, 2, '.', ''), $owner->get("/shifts/{$shop['shiftId']}")->body['expectedCash']);
        $voided = $this->buy($owner, $shop, $p, '5000.00', [['code' => $code, 'amount' => '100']], [$this->cash($shop, '4900')]);
        $this->assertStringContainsString('está anulada', $voided->body['details'][0]['message']);
    }

    public function test_vencida_no_se_usa_y_la_validez_es_de_hasta_seis_meses(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $tooLong = $this->issue($owner, $shop, '1000', [$this->cash($shop, '1000')], ['validMonths' => 7]);
        $this->assertSame(400, $tooLong->status);
        $this->assertSame('validMonths', $tooLong->body['details'][0]['path']);

        $code = $this->issue($owner, $shop, '1000', [$this->cash($shop, '1000')])->body['giftCard']['code'];
        app(TenantContext::class)->run($shop['tenantId'], fn () => GiftCard::where('code', $code)->update(['expires_on' => Carbon::now('America/Buenos_Aires')->subDay()->toDateString()]));
        $p = $this->createProduct($owner, ['price' => '1000', 'initialStock' => '5']);
        $res = $this->buy($owner, $shop, $p, '1000.00', [['code' => $code, 'amount' => '1000']]);
        $this->assertSame(400, $res->status);
        $this->assertStringContainsString('venció el', $res->body['details'][0]['message']);
        $this->assertSame('expired', $owner->get("/gift-cards/lookup?code={$code}")->body['state']);
        $this->assertSame(1, $owner->get('/gift-cards?state=expired')->body['total']);
        $this->assertSame(404, $owner->get('/gift-cards/lookup?code=GCNOEXISTE00')->status);
    }

    public function test_la_venta_de_la_tarjeta_no_se_factura(): void
    {
        $shop = $this->shop();
        $sale = $this->issue($shop['client'], $shop, '1000', [$this->cash($shop, '1000')])->body;
        $res = $shop['client']->post("/sales/{$sale['id']}/invoice", [
            'environment' => 'homologacion', 'voucherType' => 6, 'documentType' => 99, 'documentNumber' => '0', 'buyerName' => 'Consumidor final', 'vatCondition' => 5,
        ]);
        $this->assertSame('GIFT_CARD_NOT_INVOICED', $res->body['code']);
    }

    public function test_la_tarjeta_de_otro_comercio_no_existe(): void
    {
        $a = $this->shop();
        $code = $this->issue($a['client'], $a, '1000', [$this->cash($a, '1000')])->body['giftCard']['code'];
        $b = $this->shop();
        $this->assertSame(404, $b['client']->get("/gift-cards/lookup?code={$code}")->status);
        $p = $this->createProduct($b['client'], ['price' => '1000', 'initialStock' => '5']);
        $res = $this->buy($b['client'], $b, $p, '1000.00', [['code' => $code, 'amount' => '1000']]);
        $this->assertSame(400, $res->status);
        $this->assertStringContainsString('No hay ninguna gift card', $res->body['details'][0]['message']);
        $this->assertSame(0, $b['client']->get('/gift-cards')->body['total']);
    }

    /** Dos cajas que gastan a la vez todo el saldo de la misma tarjeta: solo una puede. */
    public function test_dos_cajas_no_gastan_el_mismo_saldo(): void
    {
        $shop = $this->shop();
        $code = $this->issue($shop['client'], $shop, '2000', [$this->cash($shop, '2000')])->body['giftCard']['code'];
        $p = $this->createProduct($shop['client'], ['price' => '2000', 'initialStock' => '10']);
        $body = fn () => [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'lines' => [['variantId' => $p['variantId'], 'quantity' => '1']],
            'payments' => [], 'giftCards' => [['code' => $code, 'amount' => '2000']], 'expectedTotal' => '2000.00',
        ];
        $server = new LiveServer(workers: 4);
        try {
            $results = $server->parallel(array_map(fn () => ['method' => 'POST', 'path' => '/sales', 'body' => $body()], range(1, 4)), $shop['client']->cookies);
            $diagnostic = json_encode($results, JSON_UNESCAPED_UNICODE)."\n".$server->output();
        } finally {
            $server->stop();
        }
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([201, 400, 400, 400], $statuses, $diagnostic);
        $this->assertSame('0.00', $shop['client']->get("/gift-cards/lookup?code={$code}")->body['balance']);
    }
}
