<?php

namespace Tests\Feature;

use Tests\TestCase;

/** Ingreso de mercadería y proveedores (ADR 0014). */
class PurchasesTest extends TestCase
{
    private function receive($client, string $warehouse, array $lines, array $extra = [])
    {
        return $client->post('/purchases', $extra + [
            'clientUuid' => self::uuid(), 'warehouseId' => $warehouse, 'supplierId' => null, 'updateCosts' => true, 'lines' => $lines,
        ]);
    }

    public function test_recibir_suma_stock_actualiza_costos_y_no_se_duplica(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $supplier = $owner->post('/suppliers', ['name' => 'Distribuidora Sur', 'cuit' => '20-12345678-6', 'phone' => null, 'email' => null, 'notes' => null]);
        $this->assertSame(201, $supplier->status, json_encode($supplier->body));
        $this->assertSame('20123456786', $supplier->body['cuit']);
        $this->assertSame('NAME_TAKEN', $owner->post('/suppliers', ['name' => 'Distribuidora Sur'])->body['code']);

        $a = $this->createProduct($owner, ['cost' => '600', 'initialStock' => '2']);
        $b = $this->createProduct($owner, ['cost' => null]);
        $uuid = self::uuid();
        $body = [
            'clientUuid' => $uuid, 'warehouseId' => $w, 'supplierId' => $supplier->body['id'], 'document' => 'FC A 0001-00001234', 'updateCosts' => true,
            'lines' => [['variantId' => $a['variantId'], 'quantity' => '10', 'unitCost' => '650'], ['variantId' => $b['variantId'], 'quantity' => '4', 'unitCost' => '100.5']],
        ];
        $res = $owner->post('/purchases', $body);
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertSame(1, $res->body['number']);
        $this->assertSame('6902.00', $res->body['totalCost']);
        $this->assertSame('Distribuidora Sur', $res->body['supplierName']);
        $this->assertSame(200, $owner->post('/purchases', $body)->status, 'un reintento no duplica');

        $this->assertSame('12.000', $owner->get("/products/{$a['id']}")->body['stock']);
        $this->assertSame('650.0000', $owner->get("/products/{$a['id']}")->body['variants'][0]['cost']);
        $this->assertSame('100.5000', $owner->get("/products/{$b['id']}")->body['variants'][0]['cost']);
        $this->assertSame(['purchase', 'initial'], array_column($owner->get("/products/{$a['id']}/history")->body['costs'], 'source'));
        $movement = $owner->get("/stock/movements?productId={$a['id']}")->body['items'][0];
        $this->assertSame(['purchase_in', '10.000', '12.000'], [$movement['type'], $movement['quantity'], $movement['balanceAfter']]);
        $this->assertStringContainsString('Compra N° 1 · Distribuidora Sur · FC A 0001-00001234', $movement['reason']);

        // Sin actualizar costos: suma stock y guarda el costo de la compra, pero no toca el vigente.
        $keep = $this->receive($owner, $w, [['variantId' => $a['variantId'], 'quantity' => '1', 'unitCost' => '999']], ['updateCosts' => false]);
        $this->assertSame(2, $keep->body['number']);
        $this->assertSame('650.0000', $owner->get("/products/{$a['id']}")->body['variants'][0]['cost']);
        $this->assertCount(2, $owner->get('/purchases')->body['items']);
    }

    public function test_quien_recibe_sin_permiso_de_costos_carga_solo_cantidades(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $p = $this->createProduct($owner);
        $service = $this->createProduct($owner, ['kind' => 'service', 'barcodes' => []]);
        $role = $owner->post('/roles', ['name' => 'Recepción', 'permissions' => ['products.read', 'stock.read', 'purchases.receive']])->body;
        ['client' => $client] = $this->addEmployee($owner, $role['id'], $me['branchIds']);

        $this->assertSame(403, $this->receive($client, $w, [['variantId' => $p['variantId'], 'quantity' => '3', 'unitCost' => '10']])->status);
        $ok = $this->receive($client, $w, [['variantId' => $p['variantId'], 'quantity' => '3', 'unitCost' => null]]);
        $this->assertSame(201, $ok->status, json_encode($ok->body));
        $this->assertNull($ok->body['totalCost']);
        $this->assertSame(403, $client->post('/suppliers', ['name' => 'Otro'])->status);

        $this->assertSame('STOCK_NOT_TRACKED', $this->receive($owner, $w, [['variantId' => $service['variantId'], 'quantity' => '1', 'unitCost' => null]])->body['code']);
        $half = $this->receive($owner, $w, [['variantId' => $p['variantId'], 'quantity' => '1.5', 'unitCost' => null]]);
        $this->assertSame('lines.0.quantity', $half->body['details'][0]['path']);
    }
}
