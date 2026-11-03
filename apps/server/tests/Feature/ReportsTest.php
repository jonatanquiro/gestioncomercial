<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Subscription;
use App\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Reportes (ADR 0019): ventas netas de devoluciones, agrupadas, margen según plan y permiso, y sin rotación. */
class ReportsTest extends TestCase
{
    private function shop(string $plan): array
    {
        $t = $this->registerTenant();
        app(TenantContext::class)->run($t['tenantId'], fn () => Subscription::first()->forceFill(['plan_id' => Plan::where('code', $plan)->value('id')])->save());
        $register = $t['client']->get('/registers')->body[0];
        $this->assertSame(201, $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0'])->status);
        $methods = collect($t['client']->get('/payment-methods')->body)->keyBy('kind')->all();

        return $t + ['register' => $register, 'methods' => $methods];
    }

    private function sell(ApiClient $client, array $shop, array $lines, string $total, string $kind = 'cash')
    {
        $res = $client->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'lines' => $lines,
            'payments' => [['paymentMethodId' => $shop['methods'][$kind]['id'], 'amount' => $total, 'reference' => $kind === 'cash' ? null : 'OP-1']], 'expectedTotal' => $total,
        ]);
        $this->assertSame(201, $res->status, json_encode($res->body));

        return $res->body;
    }

    private function today(): string
    {
        return Carbon::now('America/Buenos_Aires')->toDateString();
    }

    public function test_ventas_netas_agrupadas_con_margen(): void
    {
        $shop = $this->shop('profesional');
        $owner = $shop['client'];
        $remera = $this->createProduct($owner, ['name' => 'Remera', 'price' => '10000', 'cost' => '4000', 'initialStock' => '10']);
        $jean = $this->createProduct($owner, ['name' => 'Jean', 'price' => '30000', 'cost' => '12000', 'initialStock' => '5']);
        $first = $this->sell($owner, $shop, [['variantId' => $remera['variantId'], 'quantity' => '3'], ['variantId' => $jean['variantId'], 'quantity' => '1']], '60000.00');
        $this->sell($owner, $shop, [['variantId' => $remera['variantId'], 'quantity' => '1']], '10000.00', 'debit');
        // Se devuelve una remera de la primera venta.
        $owner->post("/sales/{$first['id']}/returns", [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'reason' => 'Talle', 'paymentMethodId' => $shop['methods']['cash']['id'],
            'lines' => [['saleLineId' => $first['lines'][0]['id'], 'quantity' => '1', 'restock' => true]],
        ]);
        // La venta de una gift card no es venta de mercadería.
        $owner->post('/gift-cards', ['clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'amount' => '5000', 'validMonths' => 6, 'payments' => [['paymentMethodId' => $shop['methods']['cash']['id'], 'amount' => '5000']]]);

        $report = fn (string $groupBy) => $owner->get("/reports/sales?from={$this->today()}&to={$this->today()}&groupBy={$groupBy}")->body;
        $product = $report('product');
        $this->assertTrue($product['profit']);
        $this->assertSame(['count' => 2, 'gross' => '70000.00', 'returns' => '10000.00', 'net' => '60000.00', 'averageTicket' => '30000.00', 'units' => '4.000', 'cost' => '24000.00', 'margin' => '36000.00', 'missingCost' => 0], $product['summary']);
        $rows = collect($product['rows'])->keyBy('label');
        $this->assertEqualsCanonicalizing(['Jean', 'Remera'], $rows->keys()->all());
        $this->assertSame(['30000.00', '3.000', '12000.00', '18000.00'], [$rows['Remera']['total'], $rows['Remera']['quantity'], $rows['Remera']['cost'], $rows['Remera']['margin']]);
        $this->assertSame(['30000.00', '12000.00', '18000.00'], [$rows['Jean']['total'], $rows['Jean']['cost'], $rows['Jean']['margin']]);

        $this->assertSame('Stock actual: 7', collect($report('variant')['rows'])->firstWhere('label', 'Remera')['detail']);
        $this->assertSame([['key' => $this->today(), 'label' => $this->today(), 'count' => 2, 'total' => '60000.00']], $report('day')['rows']);
        $payments = collect($report('payment')['rows'])->keyBy('label');
        $this->assertSame(['60000.00', '10000.00'], [$payments['Efectivo']['total'], $payments['Débito']['total']]);
        $this->assertSame('60000.00', $report('cashier')['rows'][0]['total']);
        $this->assertSame('Sin categoría', $report('category')['rows'][0]['label']);
        $this->assertSame('to', $owner->get('/reports/sales?from=2026-02-01&to=2026-01-01&groupBy=day')->body['details'][0]['path']);
    }

    public function test_sin_plan_avanzado_no_muestra_margen_y_el_cajero_no_ve_reportes(): void
    {
        $shop = $this->shop('inicial');
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['price' => '1000', 'cost' => '500', 'initialStock' => '5']);
        $this->sell($owner, $shop, [['variantId' => $p['variantId'], 'quantity' => '1']], '1000.00');
        $report = $owner->get("/reports/sales?from={$this->today()}&to={$this->today()}&groupBy=product")->body;
        $this->assertFalse($report['profit']);
        $this->assertArrayNotHasKey('margin', $report['summary']);
        $this->assertArrayNotHasKey('cost', $report['rows'][0]);

        ['client' => $cashier] = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $shop['me']['branchIds']);
        $this->assertSame(403, $cashier->get("/reports/sales?from={$this->today()}&to={$this->today()}&groupBy=day")->status);
    }

    public function test_sin_rotacion(): void
    {
        $shop = $this->shop('profesional');
        $owner = $shop['client'];
        $sold = $this->createProduct($owner, ['name' => 'Se vende', 'price' => '100', 'cost' => '50', 'initialStock' => '5']);
        $this->createProduct($owner, ['name' => 'Quieto', 'price' => '100', 'cost' => '40', 'initialStock' => '3']);
        $this->createProduct($owner, ['name' => 'Sin stock', 'price' => '100', 'initialStock' => '0']);
        $this->sell($owner, $shop, [['variantId' => $sold['variantId'], 'quantity' => '1']], '100.00');
        $stale = $owner->get('/reports/stale?days=30')->body;
        $this->assertSame(['Quieto'], array_column($stale['rows'], 'name'));
        $this->assertSame(['3.000', '120.00', null], [$stale['rows'][0]['stock'], $stale['rows'][0]['stockValue'], $stale['rows'][0]['lastSaleAt']]);
    }
}
