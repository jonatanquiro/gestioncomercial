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

    /** Cuenta corriente con proveedores (ADR 0018): la compra deja deuda y los pagos la bajan. */
    public function test_compra_a_pagar_y_pagos_en_efectivo_y_transferencia(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $w = $this->defaultWarehouse($owner);
        $register = $owner->get('/registers')->body[0];
        $shift = $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '50000'])->body;
        $supplier = $owner->post('/suppliers', ['name' => 'Textil Norte'])->body;
        $p = $this->createProduct($owner, ['cost' => '1000']);
        $line = [['variantId' => $p['variantId'], 'quantity' => '10', 'unitCost' => '1000']];

        $this->assertSame('payableAmount', $this->receive($owner, $w, $line, ['payableAmount' => '12100'])->body['details'][0]['path'], 'sin proveedor no hay deuda');
        $purchase = $this->receive($owner, $w, $line, ['supplierId' => $supplier['id'], 'payableAmount' => '12100']);
        $this->assertSame(201, $purchase->status, json_encode($purchase->body));
        $this->assertSame('12100.00', $purchase->body['payableAmount']);
        $this->assertSame('12100.00', $owner->get("/suppliers/{$supplier['id']}")->body['balance']);

        // Pago en efectivo: sale de la caja; no más de lo que hay.
        $pay = fn (array $body) => $owner->post("/suppliers/{$supplier['id']}/payments", $body + ['clientUuid' => self::uuid(), 'reference' => null, 'notes' => null]);
        $this->assertSame('registerId', $pay(['amount' => '100', 'method' => 'cash'])->body['details'][0]['path']);
        $this->assertSame('CASH_INSUFFICIENT', $pay(['amount' => '60000', 'method' => 'cash', 'registerId' => $register['id']])->body['code']);
        $uuid = self::uuid();
        $cash = $owner->post("/suppliers/{$supplier['id']}/payments", ['clientUuid' => $uuid, 'amount' => '7000', 'method' => 'cash', 'registerId' => $register['id']]);
        $this->assertSame(201, $cash->status, json_encode($cash->body));
        $this->assertSame('5100.00', $cash->body['balance']);
        $this->assertSame(200, $owner->post("/suppliers/{$supplier['id']}/payments", ['clientUuid' => $uuid, 'amount' => '7000', 'method' => 'cash', 'registerId' => $register['id']])->status, 'un reintento no paga dos veces');
        $this->assertSame('43000.00', $owner->get("/shifts/{$shift['id']}")->body['expectedCash']);
        $this->assertContains('supplier_payment', array_column($owner->get("/shifts/{$shift['id']}")->body['movements'], 'type'));

        // Transferencia: no toca la caja. Pagar de más deja saldo a favor.
        $transfer = $pay(['amount' => '6000', 'method' => 'transfer', 'reference' => 'Op 991']);
        $this->assertSame('-900.00', $transfer->body['balance']);
        $this->assertSame('43000.00', $owner->get("/shifts/{$shift['id']}")->body['expectedCash']);

        $adj = $owner->post("/suppliers/{$supplier['id']}/adjustments", ['amount' => '900', 'notes' => 'Nota de crédito del proveedor por faltante']);
        $this->assertSame('0.00', $adj->body['balance']);
        $detail = $owner->get("/suppliers/{$supplier['id']}")->body;
        $this->assertSame(['adjustment', 'payment', 'payment', 'purchase'], array_column($detail['movements'], 'kind'));
        $this->assertSame(1, $detail['movements'][3]['purchase']['number']);
        $this->assertSame('0.00', collect($owner->get('/suppliers')->body)->firstWhere('id', $supplier['id'])['balance']);
    }

    public function test_quien_recibe_no_deja_deuda_ni_paga(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $receiver = $owner->post('/roles', ['name' => 'Depósito', 'permissions' => ['purchases.receive', 'products.read', 'stock.read']]);
        $this->assertSame(201, $receiver->status, json_encode($receiver->body));
        ['client' => $client] = $this->addEmployee($owner, $receiver->body['id'], $me['branchIds']);
        $supplier = $owner->post('/suppliers', ['name' => 'Proveedor X'])->body;
        $p = $this->createProduct($owner);
        $res = $this->receive($client, $this->defaultWarehouse($owner), [['variantId' => $p['variantId'], 'quantity' => '1', 'unitCost' => null]], ['supplierId' => $supplier['id'], 'payableAmount' => '100']);
        $this->assertSame(403, $res->status);
        $this->assertSame(403, $client->post("/suppliers/{$supplier['id']}/payments", ['clientUuid' => self::uuid(), 'amount' => '1', 'method' => 'transfer'])->status);
    }
}
