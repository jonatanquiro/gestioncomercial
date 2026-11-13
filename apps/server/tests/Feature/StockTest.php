<?php

namespace Tests\Feature;

use App\Tenancy\TenantContext;
use Brick\Math\BigDecimal;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\ApiClient;
use Tests\Support\LiveServer;
use Tests\TestCase;

/** Fase 3 · inventario: todo cambio de stock es un movimiento y el saldo coincide con la suma. */
class StockTest extends TestCase
{
    private function adjust(ApiClient $client, string $warehouse, array $lines, ?string $clientUuid = null, string $reason = 'Ajuste de prueba')
    {
        return $client->post('/stock/adjustments', ['clientUuid' => $clientUuid ?? self::uuid(), 'warehouseId' => $warehouse, 'reason' => $reason, 'lines' => $lines]);
    }

    /** El saldo materializado de cada variante del comercio es igual a la suma de sus movimientos. */
    private function assertBalancesMatchMovements(string $tenantId): void
    {
        $rows = app(TenantContext::class)->withoutTenant(fn () => DB::select(
            'SELECT l.variant_id, l.on_hand, COALESCE(SUM(m.quantity), 0) AS moved
             FROM stock_levels l LEFT JOIN stock_movements m ON m.tenant_id = l.tenant_id AND m.warehouse_id = l.warehouse_id AND m.variant_id = l.variant_id
             WHERE l.tenant_id = ? GROUP BY l.variant_id, l.warehouse_id, l.on_hand', [$tenantId]));
        $this->assertNotEmpty($rows);
        foreach ($rows as $r) {
            $this->assertTrue(BigDecimal::of((string) $r->on_hand)->isEqualTo((string) $r->moved), "Saldo {$r->on_hand} ≠ movimientos {$r->moved} en {$r->variant_id}");
        }
    }

    public function test_ajustes_y_mermas_generan_movimientos_con_motivo_y_usuario(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $p = $this->createProduct($owner, ['initialStock' => '10', 'cost' => '250']);
        $v = $p['variantId'];

        $this->assertSame(201, $this->adjust($owner, $w, [['variantId' => $v, 'mode' => 'delta', 'quantity' => '5']], reason: 'Encontré una caja')->status);
        $this->assertSame(201, $this->adjust($owner, $w, [['variantId' => $v, 'mode' => 'set', 'quantity' => '12']], reason: 'Conteo rápido')->status);
        $waste = $owner->post('/stock/waste', ['clientUuid' => self::uuid(), 'warehouseId' => $w, 'reason' => 'Se rompieron', 'type' => 'waste', 'lines' => [['variantId' => $v, 'quantity' => '2']]]);
        $this->assertSame(201, $waste->status, json_encode($waste->body));
        $this->assertSame('10.000', $owner->get("/products/{$p['id']}")->body['stock']);

        $movements = $owner->get("/stock/movements?productId={$p['id']}")->body['items'];
        $this->assertSame(['waste', 'adjust', 'adjust', 'adjust'], array_column($movements, 'type'));
        $this->assertSame(['-2.000', '-3.000', '5.000', '10.000'], array_column($movements, 'quantity'));
        $this->assertSame(['10.000', '12.000', '15.000', '10.000'], array_column($movements, 'balanceAfter'));
        $this->assertSame(['Se rompieron', 'Conteo rápido', 'Encontré una caja', 'Stock inicial'], array_column($movements, 'reason'));
        $this->assertSame('Dueña de Prueba', $movements[0]['userName']);
        $this->assertSame('250.0000', $movements[0]['unitCost']);
        $this->assertBalancesMatchMovements($tenantId);

        $audit = $owner->get('/audit?entityType=warehouse')->body['items'];
        $this->assertSame(['stock.wasted', 'stock.adjusted', 'stock.adjusted'], array_column($audit, 'action'));
    }

    public function test_el_motivo_es_obligatorio(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $p = $this->createProduct($owner);
        $res = $this->adjust($owner, $this->defaultWarehouse($owner), [['variantId' => $p['variantId'], 'mode' => 'delta', 'quantity' => '1']], reason: '');
        $this->assertSame(400, $res->status);
        $this->assertSame('reason', $res->body['details'][0]['path']);
    }

    public function test_un_reintento_con_el_mismo_identificador_no_duplica(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $p = $this->createProduct($owner);
        $uuid = self::uuid();
        $line = [['variantId' => $p['variantId'], 'mode' => 'delta', 'quantity' => '3']];
        $this->assertTrue($this->adjust($owner, $w, $line, $uuid)->body['created']);
        $retry = $this->adjust($owner, $w, $line, $uuid);
        $this->assertSame(200, $retry->status);
        $this->assertFalse($retry->body['created']);
        $this->assertSame('3.000', $owner->get("/products/{$p['id']}")->body['stock']);
    }

    public function test_reintentos_simultaneos_y_ajustes_en_paralelo_no_desfasan_el_saldo(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $p = $this->createProduct($owner, ['initialStock' => '100']);
        $retry = self::uuid();
        $request = fn ($uuid) => ['method' => 'POST', 'path' => '/stock/adjustments', 'body' => [
            'clientUuid' => $uuid, 'warehouseId' => $w, 'reason' => 'Paralelo', 'lines' => [['variantId' => $p['variantId'], 'mode' => 'delta', 'quantity' => '-1']],
        ]];

        $server = new LiveServer(workers: 8);
        try {
            // 10 ajustes distintos y 5 copias del mismo pedido, todos a la vez.
            $results = $server->parallel([...array_map(fn () => $request(self::uuid()), range(1, 10)), ...array_fill(0, 5, $request($retry))], $owner->cookies);
            $diagnostic = json_encode($results, JSON_UNESCAPED_UNICODE)."\n".$server->output();
        } finally {
            $server->stop();
        }
        foreach ($results as $r) {
            $this->assertContains($r['status'], [200, 201], $diagnostic);
        }
        $this->assertSame('89.000', $owner->get("/products/{$p['id']}")->body['stock'], $diagnostic);
        $this->assertBalancesMatchMovements($tenantId);
    }

    public function test_stock_negativo_segun_el_comercio_y_el_producto(): void
    {
        // El rubro kiosco permite stock negativo; ferretería no.
        ['client' => $kiosco] = $this->registerTenant(['businessTypeCode' => 'kiosco']);
        $p = $this->createProduct($kiosco, ['initialStock' => '1']);
        $w = $this->defaultWarehouse($kiosco);
        $this->assertSame(201, $this->adjust($kiosco, $w, [['variantId' => $p['variantId'], 'mode' => 'delta', 'quantity' => '-3']])->status);
        $this->assertSame('-2.000', $kiosco->get("/products/{$p['id']}")->body['stock']);

        $blocked = $this->createProduct($kiosco, ['initialStock' => '1', 'blockNegativeStock' => true]);
        $res = $this->adjust($kiosco, $w, [['variantId' => $blocked['variantId'], 'mode' => 'delta', 'quantity' => '-3']]);
        $this->assertSame(409, $res->status);
        $this->assertSame('INSUFFICIENT_STOCK', $res->body['code']);
        $this->assertSame('1.000', $res->body['details'][0]['onHand']);

        ['client' => $ferreteria] = $this->registerTenant(['businessTypeCode' => 'ferreteria']);
        $f = $this->createProduct($ferreteria, ['initialStock' => '2']);
        $wf = $this->defaultWarehouse($ferreteria);
        $waste = $ferreteria->post('/stock/waste', ['clientUuid' => self::uuid(), 'warehouseId' => $wf, 'reason' => 'Rotura', 'type' => 'waste', 'lines' => [['variantId' => $f['variantId'], 'quantity' => '3']]]);
        $this->assertSame(409, $waste->status);
        $this->assertSame('2.000', $ferreteria->get("/products/{$f['id']}")->body['stock']);
        $this->assertSame([], $ferreteria->get("/stock/movements?productId={$f['id']}&type=waste")->body['items']);
    }

    public function test_los_movimientos_no_se_pueden_modificar_ni_borrar(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        $this->createProduct($owner, ['initialStock' => '5']);
        foreach (['UPDATE stock_movements SET quantity = 999 WHERE tenant_id = ?', 'DELETE FROM stock_movements WHERE tenant_id = ?'] as $sql) {
            try {
                DB::statement($sql, [$tenantId]);
                $this->fail("La base aceptó: {$sql}");
            } catch (QueryException $e) {
                $this->assertStringContainsString('solo agregado', $e->getMessage());
            }
        }
    }

    public function test_listado_de_stock_con_alerta_de_minimo(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $low = $this->createProduct($owner, ['name' => 'Bajo mínimo', 'minStock' => '5', 'initialStock' => '3']);
        $this->createProduct($owner, ['name' => 'Sobra', 'minStock' => '5', 'initialStock' => '30']);
        $this->createProduct($owner, ['name' => 'Sin mínimo', 'initialStock' => '0']);

        $all = $owner->get('/stock')->body;
        $this->assertSame(3, $all['total']);
        $this->assertSame([$low['id']], array_column($owner->get('/stock?low=1')->body['items'], 'productId'));
        $row = collect($all['items'])->firstWhere('productId', $low['id']);
        $this->assertTrue($row['low']);
        $this->assertSame('3.000', $row['onHand']);
    }

    public function test_una_sucursal_nueva_tiene_su_deposito_con_saldos_en_cero(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant(['businessTypeCode' => 'kiosco']);
        $p = $this->createProduct($owner, ['initialStock' => '4']);
        // El plan inicial tiene una sucursal: se usa uno con más.
        app(TenantContext::class)->withoutTenant(function () use ($tenantId) {
            $plan = DB::table('plans')->where('code', 'multisucursal')->value('id');
            DB::table('subscriptions')->where('tenant_id', $tenantId)->update(['plan_id' => $plan]);
        });
        $this->assertSame(201, $owner->post('/branches', ['name' => 'Sucursal 2'])->status);
        $warehouses = $owner->get('/warehouses')->body;
        $this->assertCount(2, $warehouses);
        $second = collect($warehouses)->firstWhere('branchName', 'Sucursal 2')['id'];
        $this->assertSame('0.000', $owner->get("/stock?warehouseId={$second}")->body['items'][0]['onHand']);
        $this->assertSame('4.000', $owner->get("/products/{$p['id']}")->body['stock']);
    }

    public function test_recuento_fisico_parcial_descuenta_lo_vendido_mientras_se_contaba(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $a = $this->createProduct($owner, ['initialStock' => '10']);
        $b = $this->createProduct($owner, ['initialStock' => '8']);
        $untouched = $this->createProduct($owner, ['initialStock' => '7']);

        $count = $owner->post('/stock-counts', ['warehouseId' => $w, 'scope' => 'partial', 'notes' => 'Góndola 1']);
        $this->assertSame(201, $count->status);
        $id = $count->body['id'];
        $again = $owner->post('/stock-counts', ['warehouseId' => $w, 'scope' => 'partial', 'notes' => null]);
        $this->assertSame('COUNT_ALREADY_OPEN', $again->body['code']);

        $lines = $owner->put("/stock-counts/{$id}/lines", ['lines' => [['variantId' => $a['variantId'], 'counted' => '9'], ['variantId' => $b['variantId'], 'counted' => '8']]]);
        $this->assertSame(200, $lines->status, json_encode($lines->body));
        $this->assertSame(['-1.000', '0.000'], array_column(collect($lines->body['lines'])->sortBy('name')->values()->all(), 'difference'));

        // Mientras se termina el recuento salen 2 unidades de A (como una venta).
        $this->adjust($owner, $w, [['variantId' => $a['variantId'], 'mode' => 'delta', 'quantity' => '-2']]);

        $closed = $owner->post("/stock-counts/{$id}/close");
        $this->assertSame('closed', $closed->body['status']);
        // 10 − 2 vendidas − 1 faltante = 7. B y el artículo no contado quedan igual.
        $this->assertSame('7.000', $owner->get("/products/{$a['id']}")->body['stock']);
        $this->assertSame('8.000', $owner->get("/products/{$b['id']}")->body['stock']);
        $this->assertSame('7.000', $owner->get("/products/{$untouched['id']}")->body['stock']);
        $movement = $owner->get("/stock/movements?productId={$a['id']}&type=count_adjust")->body['items'];
        $this->assertSame(['-1.000'], array_column($movement, 'quantity'));
        $this->assertSame('stock_count', $movement[0]['sourceType']);
        $this->assertSame('COUNT_NOT_OPEN', $owner->post("/stock-counts/{$id}/close")->body['code']);
        $this->assertBalancesMatchMovements($tenantId);
    }

    public function test_recuento_total_toma_como_cero_lo_que_no_se_conto(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $counted = $this->createProduct($owner, ['initialStock' => '5']);
        $missing = $this->createProduct($owner, ['initialStock' => '3']);
        $id = $owner->post('/stock-counts', ['warehouseId' => $w, 'scope' => 'total', 'notes' => null])->body['id'];
        $owner->put("/stock-counts/{$id}/lines", ['lines' => [['variantId' => $counted['variantId'], 'counted' => '6']]]);
        $closed = $owner->post("/stock-counts/{$id}/close")->body;
        $this->assertSame(2, $closed['lineCount']);
        $this->assertSame('6.000', $owner->get("/products/{$counted['id']}")->body['stock']);
        $this->assertSame('0.000', $owner->get("/products/{$missing['id']}")->body['stock']);
    }

    public function test_cancelar_un_recuento_no_mueve_stock(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $p = $this->createProduct($owner, ['initialStock' => '5']);
        $id = $owner->post('/stock-counts', ['warehouseId' => $w, 'scope' => 'partial', 'notes' => null])->body['id'];
        $owner->put("/stock-counts/{$id}/lines", ['lines' => [['variantId' => $p['variantId'], 'counted' => '1']]]);
        $this->assertSame('cancelled', $owner->post("/stock-counts/{$id}/cancel")->body['status']);
        $this->assertSame('5.000', $owner->get("/products/{$p['id']}")->body['stock']);
        // Con el recuento cancelado se puede abrir otro.
        $this->assertSame(201, $owner->post('/stock-counts', ['warehouseId' => $w, 'scope' => 'partial', 'notes' => null])->status);
    }
}
