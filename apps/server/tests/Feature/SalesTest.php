<?php

namespace Tests\Feature;

use App\Support\Money;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApiClient;
use Tests\Support\LiveServer;
use Tests\TestCase;

/** Fase 4 · punto de venta: cobro, pagos combinados, idempotencia, anulación y devolución. */
class SalesTest extends TestCase
{
    /** @return array{client: ApiClient, tenantId: string, me: array, register: array, methods: array<string, array>} */
    private function shop(array $overrides = []): array
    {
        $t = $this->registerTenant($overrides);
        $register = $t['client']->get('/registers')->body[0];
        $open = $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '1000']);
        $this->assertSame(201, $open->status, json_encode($open->body));
        $methods = collect($t['client']->get('/payment-methods')->body)->keyBy('kind')->all();

        return $t + ['register' => $register, 'shiftId' => $open->body['id'], 'methods' => $methods];
    }

    private function sale(ApiClient $client, array $shop, array $lines, array $payments, string $expectedTotal, array $extra = [])
    {
        return $client->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'lines' => $lines,
            'payments' => $payments, 'expectedTotal' => $expectedTotal,
        ] + $extra);
    }

    private function cash(array $shop, string $amount): array
    {
        return ['paymentMethodId' => $shop['methods']['cash']['id'], 'amount' => $amount];
    }

    public function test_mas_vendidos_ordena_por_ventas_recientes_y_omite_inactivos(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $this->assertSame([], $owner->get('/products/favorites')->body);
        $pan = $this->createProduct($owner, ['name' => 'Pan', 'price' => '100']);
        $queso = $this->createProduct($owner, ['name' => 'Queso', 'price' => '9000', 'saleMode' => 'weight']);
        $baja = $this->createProduct($owner, ['name' => 'Discontinuado', 'price' => '50']);
        foreach ([[$pan, '1'], [$pan, '2'], [$queso, '0.350'], [$baja, '1'], [$baja, '1'], [$baja, '1']] as [$p, $qty]) {
            $total = Money::round(Money::of($p['price'])->multipliedBy($qty));
            $this->assertSame(201, $this->sale($owner, $shop, [['variantId' => $p['variantId'], 'quantity' => $qty]], [$this->cash($shop, $total)], $total)->status);
        }
        $this->assertSame(200, $owner->post('/products/'.$baja['id'].'/status', ['status' => 'inactive', 'version' => $baja['version']])->status);
        $this->assertSame(['Pan', 'Queso'], array_column($owner->get('/products/favorites')->body, 'name'));
    }

    public function test_venta_con_pagos_combinados_mueve_stock_y_caja(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $a = $this->createProduct($owner, ['price' => '1250.50', 'initialStock' => '10']);
        $b = $this->createProduct($owner, ['price' => '999.99', 'initialStock' => '5']);

        $res = $this->sale($owner, $shop, [
            ['variantId' => $a['variantId'], 'quantity' => '3'],
            ['variantId' => $b['variantId'], 'quantity' => '1', 'discountPercent' => '10'],
        ], [
            ['paymentMethodId' => $shop['methods']['debit']['id'], 'amount' => '2000', 'reference' => '123456'],
            $this->cash($shop, '3000'),
        ], '4651.49');
        $this->assertSame(201, $res->status, json_encode($res->body));
        $sale = $res->body;
        $this->assertSame(1, $sale['number']);
        $this->assertSame('4751.49', $sale['subtotal']);
        $this->assertSame('100.00', $sale['discountTotal']);
        $this->assertSame('4651.49', $sale['total']);
        $this->assertSame('348.51', $sale['changeGiven']);
        // Lo registrado de cada pago suma exactamente el total: el vuelto se descuenta del efectivo.
        $this->assertSame(['2000.00', '2651.49'], array_column($sale['payments'], 'amount'));

        $this->assertSame('7.000', $owner->get("/products/{$a['id']}")->body['stock']);
        $this->assertSame('4.000', $owner->get("/products/{$b['id']}")->body['stock']);
        $shift = $owner->get("/shifts/{$shop['shiftId']}")->body;
        $this->assertSame('3651.49', $shift['expectedCash']);
        $this->assertSame(1, $shift['salesCount']);

        $second = $this->sale($owner, $shop, [['variantId' => $a['variantId'], 'quantity' => '1']], [$this->cash($shop, '1250.50')], '1250.50');
        $this->assertSame(2, $second->body['number']);
    }

    public function test_los_pagos_tienen_que_cubrir_el_total_y_el_vuelto_sale_del_efectivo(): void
    {
        $shop = $this->shop();
        $p = $this->createProduct($shop['client'], ['price' => '1000']);
        $line = [['variantId' => $p['variantId'], 'quantity' => '1']];

        $short = $this->sale($shop['client'], $shop, $line, [$this->cash($shop, '900')], '1000.00');
        $this->assertSame(400, $short->status);
        $this->assertSame('payments', $short->body['details'][0]['path']);

        $card = $this->sale($shop['client'], $shop, $line, [['paymentMethodId' => $shop['methods']['credit']['id'], 'amount' => '1500', 'reference' => 'A1']], '1000.00');
        $this->assertSame(400, $card->status);

        $noRef = $this->sale($shop['client'], $shop, $line, [['paymentMethodId' => $shop['methods']['debit']['id'], 'amount' => '1000']], '1000.00');
        $this->assertSame(400, $noRef->status);
        $this->assertSame('payments.0.reference', $noRef->body['details'][0]['path']);

        $changed = $this->sale($shop['client'], $shop, $line, [$this->cash($shop, '1000')], '900.00');
        $this->assertSame(409, $changed->status);
        $this->assertSame('PRICE_CHANGED', $changed->body['code']);
        $this->assertSame('1000.00', $changed->body['details']['total']);

        $this->assertSame(0, $shop['client']->get("/shifts/{$shop['shiftId']}")->body['salesCount']);
    }

    public function test_sin_turno_abierto_no_se_vende(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $register = $owner->get('/registers')->body[0];
        $p = $this->createProduct($owner);
        $cash = collect($owner->get('/payment-methods')->body)->firstWhere('kind', 'cash');
        $res = $owner->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $p['variantId'], 'quantity' => '1']],
            'payments' => [['paymentMethodId' => $cash['id'], 'amount' => '1000']], 'expectedTotal' => '1000.00',
        ]);
        $this->assertSame(409, $res->status);
        $this->assertSame('SHIFT_NOT_OPEN', $res->body['code']);
    }

    public function test_la_misma_venta_enviada_10_veces_en_paralelo_se_registra_una_vez(): void
    {
        $shop = $this->shop();
        $p = $this->createProduct($shop['client'], ['price' => '500', 'initialStock' => '20']);
        $body = [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'],
            'lines' => [['variantId' => $p['variantId'], 'quantity' => '2']],
            'payments' => [$this->cash($shop, '1000')], 'expectedTotal' => '1000.00',
        ];
        $server = new LiveServer(workers: 8);
        try {
            $results = $server->parallel(array_fill(0, 10, ['method' => 'POST', 'path' => '/sales', 'body' => $body]), $shop['client']->cookies);
            $diagnostic = json_encode($results, JSON_UNESCAPED_UNICODE)."\n".$server->output();
        } finally {
            $server->stop();
        }
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([200, 200, 200, 200, 200, 200, 200, 200, 200, 201], $statuses, $diagnostic);
        $this->assertCount(1, array_unique(array_map(fn ($r) => json_decode($r['body'], true)['id'], $results)), $diagnostic);
        $this->assertSame('18.000', $shop['client']->get("/products/{$p['id']}")->body['stock']);
        $this->assertSame('2000.00', $shop['client']->get("/shifts/{$shop['shiftId']}")->body['expectedCash']);
        $this->assertSame(1, $shop['client']->get('/sales')->body['total']);
    }

    public function test_si_falla_el_stock_no_queda_nada_registrado(): void
    {
        // Ferretería no permite stock negativo: la venta se rechaza entera.
        $shop = $this->shop(['businessTypeCode' => 'ferreteria']);
        $ok = $this->createProduct($shop['client'], ['price' => '100', 'initialStock' => '5']);
        $short = $this->createProduct($shop['client'], ['price' => '100', 'initialStock' => '1']);
        $res = $this->sale($shop['client'], $shop, [
            ['variantId' => $ok['variantId'], 'quantity' => '2'],
            ['variantId' => $short['variantId'], 'quantity' => '3'],
        ], [$this->cash($shop, '500')], '500.00');
        $this->assertSame(409, $res->status);
        $this->assertSame('INSUFFICIENT_STOCK', $res->body['code']);

        $this->assertSame('5.000', $shop['client']->get("/products/{$ok['id']}")->body['stock']);
        $this->assertSame(0, $shop['client']->get('/sales')->body['total']);
        $this->assertSame('1000.00', $shop['client']->get("/shifts/{$shop['shiftId']}")->body['expectedCash']);
        $rows = app(TenantContext::class)->withoutTenant(fn () => DB::select('SELECT COUNT(*) AS n FROM sale_lines WHERE tenant_id = ?', [$shop['tenantId']]));
        $this->assertSame(0, (int) $rows[0]->n);
        // El número no se consumió.
        $next = $this->sale($shop['client'], $shop, [['variantId' => $ok['variantId'], 'quantity' => '1']], [$this->cash($shop, '100')], '100.00');
        $this->assertSame(1, $next->body['number']);
    }

    public function test_descuentos_segun_el_limite_y_con_autorizacion(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '1000']);
        $cashierRole = $this->roleByTemplate($owner, 'cashier');
        ['client' => $cashier] = $this->addEmployee($owner, $cashierRole['id'], $shop['me']['branchIds']);
        $line = fn ($pct) => [['variantId' => $p['variantId'], 'quantity' => '1', 'discountPercent' => $pct]];

        $this->assertSame(201, $this->sale($cashier, $shop, $line('10'), [$this->cash($shop, '900')], '900.00')->status);

        $over = $this->sale($cashier, $shop, $line('20'), [$this->cash($shop, '800')], '800.00');
        $this->assertSame(403, $over->status);
        $this->assertSame('AUTHORIZATION_REQUIRED', $over->body['code']);

        // La dueña carga su PIN y autoriza.
        $this->assertSame(400, $owner->post('/auth/pos-pin', ['password' => self::PASSWORD, 'pin' => '1111'])->status);
        $this->assertSame(200, $owner->post('/auth/pos-pin', ['password' => self::PASSWORD, 'pin' => '4826'])->status);
        $authorizers = $cashier->get('/pos/authorizers?permission=sales.discount_unlimited')->body;
        $this->assertCount(1, $authorizers);
        $wrong = $this->sale($cashier, $shop, $line('20'), [$this->cash($shop, '800')], '800.00', ['authorization' => ['membershipId' => $authorizers[0]['membershipId'], 'pin' => '0000']]);
        $this->assertSame('AUTHORIZATION_INVALID', $wrong->body['code']);
        $ok = $this->sale($cashier, $shop, $line('20'), [$this->cash($shop, '800')], '800.00', ['authorization' => ['membershipId' => $authorizers[0]['membershipId'], 'pin' => '4826']]);
        $this->assertSame(201, $ok->status, json_encode($ok->body));
        $this->assertSame('Dueña de Prueba', $ok->body['discountAuthorizedBy']);
    }

    public function test_anulacion_con_movimientos_inversos_y_auditoria(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '700', 'initialStock' => '4']);
        $sale = $this->sale($owner, $shop, [['variantId' => $p['variantId'], 'quantity' => '2']], [$this->cash($shop, '2000')], '1400.00')->body;

        $cashierRole = $this->roleByTemplate($owner, 'cashier');
        ['client' => $cashier] = $this->addEmployee($owner, $cashierRole['id'], $shop['me']['branchIds']);
        $own = $this->sale($cashier, $shop, [['variantId' => $p['variantId'], 'quantity' => '1']], [$this->cash($shop, '700')], '700.00')->body;
        $denied = $cashier->post("/sales/{$own['id']}/void", ['reason' => 'Se arrepintió']);
        $this->assertSame('AUTHORIZATION_REQUIRED', $denied->body['code']);

        $res = $owner->post("/sales/{$sale['id']}/void", ['reason' => 'Error de carga']);
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame('voided', $res->body['status']);
        $this->assertSame('Error de carga', $res->body['void']['reason']);
        $this->assertSame('3.000', $owner->get("/products/{$p['id']}")->body['stock']);
        $this->assertSame('1700.00', $owner->get("/shifts/{$shop['shiftId']}")->body['expectedCash']);
        $this->assertSame(409, $owner->post("/sales/{$sale['id']}/void", ['reason' => 'Otra vez'])->status);
        $audit = collect($owner->get('/audit')->body['items'])->firstWhere('action', 'sale.voided');
        $this->assertNotNull($audit);

        // Con el turno cerrado ya no se anula: se devuelve.
        $this->assertSame(200, $owner->post("/shifts/{$shop['shiftId']}/close", ['counted' => '1700'])->status);
        $late = $owner->post("/sales/{$own['id']}/void", ['reason' => 'Tarde']);
        $this->assertSame(409, $late->status);
    }

    public function test_devoluciones_parciales_no_superan_lo_vendido(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '33.33', 'initialStock' => '10']);
        $sale = $this->sale($owner, $shop, [['variantId' => $p['variantId'], 'quantity' => '3']], [$this->cash($shop, '100')], '99.99')->body;
        $lineId = $sale['lines'][0]['id'];
        $return = fn (string $qty, bool $restock = true) => $owner->post("/sales/{$sale['id']}/returns", [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'reason' => 'Vencido', 'paymentMethodId' => $shop['methods']['cash']['id'],
            'lines' => [['saleLineId' => $lineId, 'quantity' => $qty, 'restock' => $restock]],
        ]);

        $first = $return('1');
        $this->assertSame(201, $first->status, json_encode($first->body));
        $this->assertSame('33.33', $first->body['returns'][0]['total']);
        $this->assertSame('8.000', $owner->get("/products/{$p['id']}")->body['stock']);

        $this->assertSame(400, $return('3')->status);

        $last = $return('2', false);
        $this->assertSame(201, $last->status);
        $this->assertSame('66.66', $last->body['returns'][1]['total']);
        $this->assertSame('3.000', $last->body['lines'][0]['returnedQuantity']);
        // Sin reponer: el stock no vuelve.
        $this->assertSame('8.000', $owner->get("/products/{$p['id']}")->body['stock']);
        $this->assertSame('1000.00', $owner->get("/shifts/{$shop['shiftId']}")->body['expectedCash']);
        $this->assertSame(409, $owner->post("/sales/{$sale['id']}/void", ['reason' => 'x'])->status);
    }

    public function test_el_vendedor_ve_solo_sus_ventas(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '100']);
        $this->sale($owner, $shop, [['variantId' => $p['variantId'], 'quantity' => '1']], [$this->cash($shop, '100')], '100.00');
        $seller = $this->roleByTemplate($owner, 'seller');
        ['client' => $client] = $this->addEmployee($owner, $seller['id'], $shop['me']['branchIds']);
        $mine = $this->sale($client, $shop, [['variantId' => $p['variantId'], 'quantity' => '1']], [$this->cash($shop, '100')], '100.00');
        $this->assertSame(201, $mine->status);
        $list = $client->get('/sales')->body;
        $this->assertSame(1, $list['total']);
        $this->assertSame($mine->body['id'], $list['items'][0]['id']);
        $this->assertSame(2, $owner->get('/sales')->body['total']);
    }
}
