<?php

namespace Tests\Feature;

use Tests\Support\ApiClient;
use Tests\TestCase;

/** Clientes y cuenta corriente (ADR 0016): alta, fiado con límite, cobro, devolución y anulación. */
class CustomersTest extends TestCase
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

    private static function customer(array $overrides = []): array
    {
        return $overrides + ['name' => 'Marta Gómez', 'documentType' => 96, 'documentNumber' => (string) random_int(20000000, 45000000), 'vatCondition' => 5,
            'phone' => '11 5555-0000', 'email' => null, 'address' => null, 'notes' => null, 'creditLimit' => null];
    }

    private function sell(ApiClient $client, array $shop, array $product, string $quantity, string $total, array $extra = [], array $payments = [])
    {
        return $client->post('/sales', $extra + [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'],
            'lines' => [['variantId' => $product['variantId'], 'quantity' => $quantity]], 'payments' => $payments, 'expectedTotal' => $total,
        ]);
    }

    private function cash(array $shop, string $amount): array
    {
        return ['paymentMethodId' => $shop['methods']['cash']['id'], 'amount' => $amount];
    }

    private function expectedCash(array $shop): string
    {
        return $shop['client']->get("/shifts/{$shop['shiftId']}")->body['expectedCash'];
    }

    public function test_alta_con_documento_validado_y_unico(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $bad = $owner->post('/customers', self::customer(['documentNumber' => '12']));
        $this->assertSame('Ingresá un DNI válido, sin puntos', $bad->body['details'][0]['message']);
        $this->assertSame('El CUIT o CUIL no es válido', $owner->post('/customers', self::customer(['documentType' => 80, 'documentNumber' => '20-12345678-0']))->body['details'][0]['message']);
        $half = $owner->post('/customers', self::customer(['documentType' => null]));
        $this->assertSame('documentNumber', $half->body['details'][0]['path']);

        $cuit = self::randomCuit();
        $ok = $owner->post('/customers', self::customer(['documentType' => 80, 'documentNumber' => substr($cuit, 0, 2).'-'.substr($cuit, 2, 8).'-'.substr($cuit, 10), 'vatCondition' => 1]));
        $this->assertSame(201, $ok->status, json_encode($ok->body));
        $this->assertSame([$cuit, '0.00', null], [$ok->body['documentNumber'], $ok->body['balance'], $ok->body['creditLimit']]);
        $this->assertSame('DOCUMENT_TAKEN', $owner->post('/customers', self::customer(['name' => 'Otro', 'documentType' => 80, 'documentNumber' => $cuit]))->body['code']);
        $this->assertSame(1, $owner->get('/customers?q='.substr($cuit, 0, 5))->body['total']);
        $this->assertSame(201, $owner->post('/customers', self::customer(['name' => 'Sin documento', 'documentType' => null, 'documentNumber' => null]))->status);
    }

    public function test_el_cajero_carga_clientes_pero_no_da_credito(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        ['client' => $cashier] = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $me['branchIds']);
        $this->assertSame(403, $cashier->post('/customers', self::customer(['creditLimit' => '50000']))->status);
        $created = $cashier->post('/customers', self::customer());
        $this->assertSame(201, $created->status, json_encode($created->body));
        // Al editar sin el permiso, el límite no cambia.
        $owner->put("/customers/{$created->body['id']}", [...$created->body, 'creditLimit' => '1000']);
        $edit = $cashier->put("/customers/{$created->body['id']}", [...$created->body, 'name' => 'Marta G.', 'creditLimit' => '999999']);
        $this->assertSame(['Marta G.', '1000.00'], [$edit->body['name'], $edit->body['creditLimit']]);
    }

    public function test_fiado_con_limite_cobro_devolucion_y_anulacion(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $p = $this->createProduct($owner, ['name' => 'Remera', 'price' => '5000', 'initialStock' => '20']);
        $marta = $owner->post('/customers', self::customer(['creditLimit' => '20000']))->body;
        $sinCredito = $owner->post('/customers', self::customer(['name' => 'Juan']))->body;

        $this->assertStringContainsString('elegí el cliente', $this->sell($owner, $shop, $p, '1', '5000.00', ['accountAmount' => '5000'])->body['details'][0]['message']);
        $this->assertStringContainsString('no tiene cuenta corriente habilitada', $this->sell($owner, $shop, $p, '1', '5000.00', ['customerId' => $sinCredito['id'], 'accountAmount' => '5000'])->body['details'][0]['message']);

        // 3 remeras (15.000) a cuenta: la caja no se mueve.
        $cash = $this->expectedCash($shop);
        $sale = $this->sell($owner, $shop, $p, '3', '15000.00', ['customerId' => $marta['id'], 'accountAmount' => '15000']);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame(['account'], array_column($sale->body['payments'], 'kind'));
        $this->assertSame('Marta Gómez', $sale->body['customer']['name']);
        $this->assertSame($cash, $this->expectedCash($shop));
        $this->assertSame('15000.00', $owner->get("/customers/{$marta['id']}")->body['balance']);

        // Supera el límite (15.000 + 10.000 > 20.000), pero puede pagar una parte a cuenta y el resto en efectivo.
        $over = $this->sell($owner, $shop, $p, '2', '10000.00', ['customerId' => $marta['id'], 'accountAmount' => '10000']);
        $this->assertStringContainsString('Supera el límite', $over->body['details'][0]['message']);
        $mixed = $this->sell($owner, $shop, $p, '2', '10000.00', ['customerId' => $marta['id'], 'accountAmount' => '5000'], [$this->cash($shop, '5000')]);
        $this->assertSame(201, $mixed->status, json_encode($mixed->body));
        $this->assertSame('20000.00', $owner->get("/customers/{$marta['id']}")->body['balance']);

        // Cobro de 8.000 en efectivo: entra a la caja y baja la deuda; no se cobra más de lo que debe.
        $collect = fn (string $amount, array $payments) => $owner->post("/customers/{$marta['id']}/payments", ['clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'amount' => $amount, 'payments' => $payments]);
        $this->assertStringContainsString('debe $ 20.000', $collect('25000', [$this->cash($shop, '25000')])->body['details'][0]['message']);
        $cash = $this->expectedCash($shop);
        $payment = $collect('8000', [$this->cash($shop, '10000')]);
        $this->assertSame(201, $payment->status, json_encode($payment->body));
        $this->assertSame(['account_payment', '2000.00'], [$payment->body['kind'], $payment->body['changeGiven']]);
        $this->assertSame(number_format((float) $cash + 8000, 2, '.', ''), $this->expectedCash($shop));
        $this->assertSame('12000.00', $owner->get("/customers/{$marta['id']}")->body['balance']);

        // El resumen del día cuenta las ventas (25.000), no el cobro de la deuda; el fiado no es un cobro a rendir.
        $today = $owner->get('/dashboard/today')->body['sales'];
        $this->assertSame(['25000.00', 2], [$today['total'], $today['count']]);
        $this->assertNotContains('account', array_column($owner->get('/payments')->body['items'], 'kind'));
        $this->assertNotContains('account', array_column($owner->get('/payment-methods')->body, 'kind'));
        $this->assertSame('ACCOUNT_PAYMENT_NOT_INVOICED', $owner->post("/sales/{$payment->body['id']}/invoice", [
            'environment' => 'homologacion', 'voucherType' => 6, 'documentType' => 99, 'documentNumber' => '0', 'buyerName' => 'Consumidor final', 'vatCondition' => 5,
        ])->body['code']);

        // Devolución de una remera fiada: baja la deuda, no sale efectivo.
        $cash = $this->expectedCash($shop);
        $return = $owner->post("/sales/{$sale->body['id']}/returns", [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'reason' => 'Falla', 'paymentMethodId' => $shop['methods']['cash']['id'],
            'lines' => [['saleLineId' => $sale->body['lines'][0]['id'], 'quantity' => '1', 'restock' => true]],
        ]);
        $this->assertSame(201, $return->status, json_encode($return->body));
        $this->assertSame('5000.00', $return->body['returns'][0]['accountAmount']);
        $this->assertSame($cash, $this->expectedCash($shop));
        $this->assertSame('7000.00', $owner->get("/customers/{$marta['id']}")->body['balance']);

        // Anular el cobro devuelve la deuda; anular la venta mixta saca de la cuenta solo lo fiado.
        $this->assertSame(200, $owner->post("/sales/{$payment->body['id']}/void", ['reason' => 'Error'])->status);
        $this->assertSame('15000.00', $owner->get("/customers/{$marta['id']}")->body['balance']);
        $this->assertSame(200, $owner->post("/sales/{$mixed->body['id']}/void", ['reason' => 'Error'])->status);
        $detail = $owner->get("/customers/{$marta['id']}")->body;
        $this->assertSame('10000.00', $detail['balance']);
        $this->assertSame(['void', 'void', 'return', 'payment', 'sale', 'sale'], array_column($detail['movements'], 'kind'));
        $this->assertSame(['10000.00'], [$owner->get('/customers?withDebt=true')->body['receivable']]);
        $this->assertSame(3, $owner->get("/sales?customerId={$marta['id']}")->body['total'], 'venta fiada, venta mixta y cobro');
    }

    public function test_saldo_inicial_y_saldo_a_favor(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $c = $owner->post('/customers', self::customer())->body;
        $this->assertSame('notes', $owner->post("/customers/{$c['id']}/adjustments", ['amount' => '100'])->body['details'][0]['path']);
        $adj = $owner->post("/customers/{$c['id']}/adjustments", ['amount' => '-3000', 'notes' => 'Seña de un pedido']);
        $this->assertSame('-3000.00', $adj->body['balance']);
        // Con saldo a favor compra a cuenta aunque no tenga crédito.
        $p = $this->createProduct($owner, ['price' => '2000', 'initialStock' => '5']);
        $sale = $this->sell($owner, $shop, $p, '1', '2000.00', ['customerId' => $c['id'], 'accountAmount' => '2000']);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame('-1000.00', $owner->get("/customers/{$c['id']}")->body['balance']);
    }

    public function test_el_cliente_de_otro_comercio_no_existe(): void
    {
        $a = $this->shop();
        $c = $a['client']->post('/customers', self::customer(['creditLimit' => '10000']))->body;
        $b = $this->shop();
        $this->assertSame(404, $b['client']->get("/customers/{$c['id']}")->status);
        $p = $this->createProduct($b['client'], ['price' => '100', 'initialStock' => '5']);
        $res = $this->sell($b['client'], $b, $p, '1', '100.00', ['customerId' => $c['id'], 'accountAmount' => '100']);
        $this->assertSame('El cliente no existe o está desactivado', $res->body['details'][0]['message']);
    }
}
