<?php

namespace Tests\Feature;

use Tests\TestCase;

class SettlementsTest extends TestCase
{
    public function test_importa_verifica_y_cierra_sin_duplicar_cobros(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $method = collect($owner->get('/payment-methods')->body)->firstWhere('kind', 'transfer');
        $register = $owner->get('/registers')->body[0];
        $this->assertSame(201, $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0'])->status);
        $product = $this->createProduct($owner, ['price' => '1250.50', 'initialStock' => '2']);
        $sale = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $method['id'], 'amount' => '1250.50', 'reference' => 'OPERACION-1']], 'expectedTotal' => '1250.50']);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $date = now('America/Buenos_Aires')->format('Y-m-d');
        $body = ['paymentMethodId' => $method['id'], 'provider' => 'Mercado Pago', 'fromDate' => $date, 'toDate' => $date];
        $created = $owner->post('/settlements', $body);
        $this->assertSame(201, $created->status, json_encode($created->body));
        $id = $created->body['id'];
        $this->assertCount(1, $created->body['items']);
        $this->assertSame(409, $owner->post('/settlements', $body)->status);
        $this->assertSame(409, $owner->post("/settlements/{$id}/close", ['notes' => 'Sin revisar'])->status);
        $import = ['csv' => "id;bruto;comision\nOPERACION-1;1250,50;25,01", 'delimiter' => ';', 'decimal' => ',', 'columns' => ['reference' => 0, 'gross' => 1, 'fees' => 2]];
        $res = $owner->post("/settlements/{$id}/import", $import);
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame('confirmed', $res->body['items'][0]['status']);
        $this->assertSame('1225.49', $res->body['totals']['net']);
        $this->assertSame(409, $owner->post("/settlements/{$id}/import", $import)->status);
        $this->assertSame(200, $owner->post("/settlements/{$id}/close", ['notes' => 'Verificado con el reporte de la cuenta'])->status);
        $this->assertSame(409, $owner->post("/settlements/{$id}/refresh", [])->status);
        $this->assertSame('confirmed', $owner->get('/sales/'.$sale->body['id'])->body['status']);
        $again = $owner->post('/settlements', $body);
        $this->assertSame(201, $again->status);
        $this->assertSame([], $again->body['items']);
        $this->assertSame(409, $owner->post('/settlements/'.$again->body['id'].'/import', $import)->status);
        $second = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $method['id'], 'amount' => '1250.50', 'reference' => 'REFERENCIA-MANUAL']], 'expectedTotal' => '1250.50']);
        $this->assertSame(201, $second->status);
        $nextId = $again->body['id'];
        $updated = $owner->post("/settlements/{$nextId}/refresh", []);
        $this->assertSame(200, $updated->status);
        $this->assertCount(1, $updated->body['items']);
        $manualImport = [...$import, 'csv' => "id;bruto;comision\nID-PROVEEDOR-2;1250,50;25,01"];
        $unmatched = $owner->post("/settlements/{$nextId}/import", $manualImport);
        $this->assertSame(200, $unmatched->status);
        $this->assertCount(2, $unmatched->body['items']);
        $external = collect($unmatched->body['items'])->firstWhere('saleId', null);
        $expected = collect($unmatched->body['items'])->firstWhere('saleId', $second->body['id']);
        $linked = $owner->post("/settlements/{$nextId}/match", ['reportItemId' => $external['id'], 'saleItemId' => $expected['id'], 'notes' => 'Verificado en el detalle del proveedor']);
        $this->assertSame(200, $linked->status, json_encode($linked->body));
        $this->assertCount(1, $linked->body['items']);
        $this->assertSame('confirmed', $linked->body['items'][0]['status']);
        $this->assertSame(200, $owner->post("/settlements/{$nextId}/close", ['notes' => 'Segundo cierre del día con nuevos cobros'])->status);
    }
}
