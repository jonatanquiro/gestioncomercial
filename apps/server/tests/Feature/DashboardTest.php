<?php

namespace Tests\Feature;

use Tests\TestCase;

class DashboardTest extends TestCase
{
    public function test_resumen_del_dia_segun_permisos(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $methods = collect($owner->get('/payment-methods')->body);
        $register = $owner->get('/registers')->body[0];
        $this->assertSame(201, $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '1000'])->status);
        $yerba = $this->createProduct($owner, ['name' => 'Yerba', 'price' => '500', 'initialStock' => '3', 'minStock' => '2']);
        $this->createProduct($owner, ['name' => 'Azúcar', 'price' => '100', 'initialStock' => '10', 'minStock' => '2']);
        $sell = fn (string $kind, ?string $reference) => $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $yerba['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $methods->firstWhere('kind', $kind)['id'], 'amount' => '500', 'reference' => $reference]], 'expectedTotal' => '500.00']);
        $this->assertSame(201, $sell('cash', null)->status);
        $this->assertSame(201, $sell('transfer', 'OP-1')->status);

        $today = $owner->get('/dashboard/today');
        $this->assertSame(200, $today->status, json_encode($today->body));
        $this->assertSame(['scope' => 'all', 'count' => 2, 'total' => '1000.00', 'cash' => '500.00', 'electronic' => '500.00'], $today->body['sales']);
        $this->assertSame(['openShifts' => 1, 'expected' => '1500.00'], $today->body['cash']);
        $this->assertSame(1, $today->body['payments']['unsettledCount']);
        $this->assertSame(['lowCount' => 1, 'lowNames' => ['Yerba']], $today->body['stock']);

        // El cajero ve solo sus ventas, sin caja general ni cobros.
        $cashier = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $me['branchIds'])['client'];
        $own = $cashier->get('/dashboard/today')->body;
        $this->assertSame(['scope' => 'own', 'count' => 0, 'total' => '0.00', 'cash' => '0.00', 'electronic' => '0.00'], $own['sales']);
        $this->assertArrayNotHasKey('cash', $own);
        $this->assertArrayNotHasKey('payments', $own);
    }
}
