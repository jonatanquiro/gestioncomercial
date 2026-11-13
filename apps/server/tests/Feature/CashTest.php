<?php

namespace Tests\Feature;

use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Fase 4 · caja: apertura, retiros, arqueo parcial y cierre ciego; un turno cerrado queda fijo. */
class CashTest extends TestCase
{
    public function test_turno_completo_con_cierre_ciego(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $register = $owner->get('/registers')->body[0];
        $this->assertSame('Caja 1', $register['name']);
        $this->assertNull($register['openShift']);

        $cashierRole = $this->roleByTemplate($owner, 'cashier');
        ['client' => $cashier] = $this->addEmployee($owner, $cashierRole['id'], $me['branchIds']);
        $open = $cashier->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '5000']);
        $this->assertSame(201, $open->status, json_encode($open->body));
        $shiftId = $open->body['id'];
        $again = $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0']);
        $this->assertSame(409, $again->status);
        $this->assertSame('SHIFT_ALREADY_OPEN', $again->body['code']);
        $this->assertSame($shiftId, $owner->get('/registers')->body[0]['openShift']['id']);

        $methods = collect($owner->get('/payment-methods')->body)->keyBy('kind');
        $p = $this->createProduct($owner, ['price' => '1500']);
        $sale = $cashier->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $p['variantId'], 'quantity' => '2']],
            'payments' => [['paymentMethodId' => $methods['cash']['id'], 'amount' => '2000'], ['paymentMethodId' => $methods['qr']['id'], 'amount' => '1000', 'reference' => 'MP-1']],
            'expectedTotal' => '3000.00',
        ]);
        $this->assertSame(201, $sale->status, json_encode($sale->body));

        // El cajero no tiene permiso de retiro; la dueña sí.
        $this->assertSame(403, $cashier->post("/shifts/{$shiftId}/movements", ['type' => 'withdrawal', 'amount' => '100', 'reason' => 'x'])->status);
        $tooMuch = $owner->post("/shifts/{$shiftId}/movements", ['type' => 'withdrawal', 'amount' => '99999', 'reason' => 'Banco']);
        $this->assertSame('CASH_INSUFFICIENT', $tooMuch->body['code']);
        $this->assertSame(201, $owner->post("/shifts/{$shiftId}/movements", ['type' => 'withdrawal', 'amount' => '3000', 'reason' => 'Retiro a caja fuerte'])->status);
        $this->assertSame(201, $owner->post("/shifts/{$shiftId}/movements", ['type' => 'deposit', 'amount' => '500', 'reason' => 'Cambio'])->status);

        // Arqueo parcial a ciegas: el cajero no ve el esperado.
        $count = $cashier->post("/shifts/{$shiftId}/counts", ['counted' => '4500']);
        $this->assertSame(201, $count->status);
        $this->assertNull($count->body['expectedCash']);
        $this->assertNull($count->body['counts'][0]['expected']);
        $this->assertSame('4500.00', $owner->get("/shifts/{$shiftId}")->body['expectedCash']);
        $this->assertSame('0.00', $owner->get("/shifts/{$shiftId}")->body['counts'][0]['difference']);

        $close = $cashier->post("/shifts/{$shiftId}/close", ['counted' => '4480', 'notes' => 'Faltan monedas']);
        $this->assertSame(200, $close->status, json_encode($close->body));
        $this->assertSame('closed', $close->body['status']);
        $this->assertSame('4500.00', $close->body['expectedCash']);
        $this->assertSame('-20.00', $close->body['difference']);
        $byMethod = collect($close->body['totalsByMethod'])->keyBy('kind');
        $this->assertSame('2000.00', $byMethod['cash']['net']);
        $this->assertSame('1000.00', $byMethod['qr']['net']);

        // Cerrado, no se toca: ni por la API ni directo en la base.
        $this->assertSame('SHIFT_CLOSED', $owner->post("/shifts/{$shiftId}/close", ['counted' => '4500'])->body['code']);
        $this->assertSame('SHIFT_CLOSED', $owner->post("/shifts/{$shiftId}/movements", ['type' => 'deposit', 'amount' => '20', 'reason' => 'x'])->body['code']);
        try {
            app(TenantContext::class)->withoutTenant(fn () => DB::update('UPDATE cash_shifts SET counted_cash = 4500 WHERE id = ?', [$shiftId]));
            $this->fail('Se pudo modificar un turno cerrado');
        } catch (QueryException $e) {
            $this->assertStringContainsString('cerrado no se puede modificar', $e->getMessage());
        }
        $this->assertSame(1, $owner->get('/shifts?status=closed')->body['total']);
        $this->assertNull($owner->get('/registers')->body[0]['openShift']);
    }

    public function test_cajas_y_medios_de_pago_respetan_el_plan_y_los_nombres(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $branchId = $me['branchIds'][0];
        // El plan inicial trae 1 caja.
        $res = $owner->post('/registers', ['branchId' => $branchId, 'name' => 'Caja 2']);
        $this->assertSame(402, $res->status);
        $this->assertSame('max_registers', $res->body['details']['limit']);

        $method = $owner->post('/payment-methods', ['name' => 'Cuenta DNI', 'kind' => 'qr', 'requiresReference' => true, 'active' => true, 'sortOrder' => 6]);
        $this->assertSame(201, $method->status, json_encode($method->body));
        $dup = $owner->post('/payment-methods', ['name' => 'Cuenta DNI', 'kind' => 'qr', 'requiresReference' => true, 'active' => true, 'sortOrder' => 7]);
        $this->assertSame('NAME_TAKEN', $dup->body['code']);
        $this->assertSame(200, $owner->put("/payment-methods/{$method->body['id']}", ['name' => 'Cuenta DNI', 'kind' => 'qr', 'requiresReference' => true, 'active' => false, 'sortOrder' => 6])->status);
        $this->assertFalse(collect($owner->get('/payment-methods')->body)->firstWhere('name', 'Cuenta DNI')['active']);
    }
}
