<?php

namespace Tests\Feature;

use Tests\TestCase;

class PaymentsTest extends TestCase
{
    public function test_lista_cobros_no_efectivo_con_filtros_y_senales(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $methods = collect($owner->get('/payment-methods')->body);
        $transfer = $methods->firstWhere('kind', 'transfer');
        $cash = $methods->firstWhere('kind', 'cash');
        $loose = $owner->post('/payment-methods', ['name' => 'Alias sin comprobante', 'kind' => 'transfer', 'requiresReference' => false, 'active' => true, 'sortOrder' => 9]);
        $this->assertSame(201, $loose->status, json_encode($loose->body));
        $register = $owner->get('/registers')->body[0];
        $this->assertSame(201, $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0'])->status);
        $product = $this->createProduct($owner, ['price' => '1000', 'initialStock' => '10']);
        $sell = function (string $methodId, ?string $reference) use ($owner, $register, $product) {
            $res = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $methodId, 'amount' => '1000', 'reference' => $reference]], 'expectedTotal' => '1000.00']);
            $this->assertSame(201, $res->status, json_encode($res->body));

            return $res->body;
        };
        $first = $sell($transfer['id'], 'OP-777');
        $second = $sell($transfer['id'], 'op-777');
        $sell($loose->body['id'], null);
        $sell($cash['id'], null);

        $all = $owner->get('/payments');
        $this->assertSame(200, $all->status, json_encode($all->body));
        $this->assertSame(3, $all->body['total']);
        $this->assertSame('3000.00', $all->body['totalAmount']);
        $this->assertNotContains('cash', array_column($all->body['items'], 'kind'));
        $this->assertSame(2, $owner->get('/payments?flag=duplicate')->body['total']);
        $this->assertTrue(collect($all->body['items'])->firstWhere('saleId', $first['id'])['duplicateReference']);
        $this->assertSame(1, $owner->get('/payments?flag=missing_reference')->body['total']);
        $this->assertSame(2, $owner->get('/payments?q=OP-7')->body['total']);
        $this->assertSame([$second['id']], array_column($owner->get('/payments?q='.$second['number'])->body['items'], 'saleId'));
        $this->assertSame(2, $owner->get('/payments?paymentMethodId='.$transfer['id'])->body['total']);
        $this->assertSame(0, $owner->get('/payments?from=2020-01-01&to=2020-01-31')->body['total']);
        $this->assertSame(400, $owner->get('/payments?kind=cash')->status);

        // Anular una de las dos ventas deja de marcar la operación como repetida.
        $this->assertSame(200, $owner->post('/sales/'.$second['id'].'/void', ['reason' => 'Cobro duplicado'])->status);
        $this->assertSame(0, $owner->get('/payments?flag=duplicate')->body['total']);
        $this->assertSame([$second['id']], array_column($owner->get('/payments?flag=sale_changed')->body['items'], 'saleId'));

        $date = now('America/Buenos_Aires')->format('Y-m-d');
        $this->assertSame(3, $owner->get("/payments?from={$date}&to={$date}&settlement=none")->body['total']);
        $settlement = $owner->post('/settlements', ['paymentMethodId' => $transfer['id'], 'provider' => 'Banco', 'fromDate' => $date, 'toDate' => $date]);
        $this->assertSame(201, $settlement->status);
        $pending = $owner->get('/payments?settlement=pending');
        $this->assertSame(1, $pending->body['total']);
        $this->assertSame(['id' => $settlement->body['id'], 'provider' => 'Banco', 'status' => 'open', 'itemStatus' => 'pending'], $pending->body['items'][0]['settlement']);
        $this->assertSame(2, $owner->get('/payments?settlement=none')->body['total']);

        // Nombre y teléfono de quien transfiere: se guardan, se muestran y se buscan; el efectivo no los guarda.
        $payer = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $transfer['id'], 'amount' => '1000', 'reference' => 'OP-900', 'payerName' => ' Juana Pérez ', 'payerPhone' => '11 5555-1234']], 'expectedTotal' => '1000.00']);
        $this->assertSame(201, $payer->status, json_encode($payer->body));
        $this->assertSame(['Juana Pérez', '11 5555-1234'], [$payer->body['payments'][0]['payerName'], $payer->body['payments'][0]['payerPhone']]);
        $this->assertSame([$payer->body['id']], array_column($owner->get('/payments?q=Pérez')->body['items'], 'saleId'));
        $this->assertSame('11 5555-1234', $owner->get('/payments?q=5555')->body['items'][0]['payerPhone']);
        $badPhone = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $transfer['id'], 'amount' => '1000', 'reference' => 'OP-901', 'payerPhone' => 'llamame']], 'expectedTotal' => '1000.00']);
        $this->assertSame(400, $badPhone->status);
        $cashPayer = $owner->post('/sales', ['clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']], 'payments' => [['paymentMethodId' => $cash['id'], 'amount' => '1000', 'payerName' => 'Nadie']], 'expectedTotal' => '1000.00']);
        $this->assertNull($cashPayer->body['payments'][0]['payerName']);

        $cashier = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $me['branchIds']);
        $this->assertSame(403, $cashier['client']->get('/payments')->status);
    }
}
