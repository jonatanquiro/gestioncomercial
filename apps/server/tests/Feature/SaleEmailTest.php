<?php

namespace Tests\Feature;

use App\Mail\SaleReceiptMail;
use Illuminate\Support\Facades\Mail;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Envío del comprobante por email: el ticket al cliente, sin guardar el email salvo que se pida. */
class SaleEmailTest extends TestCase
{
    private function shop(): array
    {
        $t = $this->registerTenant();
        $register = $t['client']->get('/registers')->body[0];
        $open = $t['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '1000']);
        $this->assertSame(201, $open->status, json_encode($open->body));
        $cash = collect($t['client']->get('/payment-methods')->body)->firstWhere('kind', 'cash');

        return $t + ['register' => $register, 'cash' => $cash];
    }

    private function sell(ApiClient $client, array $shop, array $product, ?string $customerId = null): array
    {
        $res = $client->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $shop['register']['id'], 'customerId' => $customerId,
            'lines' => [['variantId' => $product['variantId'], 'quantity' => '2']],
            'payments' => [['paymentMethodId' => $shop['cash']['id'], 'amount' => '3000']], 'expectedTotal' => '2400.00',
        ]);
        $this->assertSame(201, $res->status, json_encode($res->body));

        return $res->body;
    }

    public function test_manda_el_ticket_y_guarda_el_email_solo_si_se_pide(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $product = $this->createProduct($owner, ['name' => 'Remera lisa', 'price' => '1200', 'initialStock' => '10']);
        $customer = $owner->post('/customers', ['name' => 'Marta Gómez', 'documentType' => null, 'documentNumber' => null, 'vatCondition' => 5])->body;
        $sale = $this->sell($owner, $shop, $product, $customer['id']);

        $bad = $owner->post("/sales/{$sale['id']}/email", ['email' => 'marta@']);
        $this->assertSame(['email', 'Email inválido'], [$bad->body['details'][0]['path'], $bad->body['details'][0]['message']]);
        Mail::assertNothingSent();

        // Sin pedirlo, el email no queda en ningún lado salvo la auditoría.
        $ok = $owner->post("/sales/{$sale['id']}/email", ['email' => ' Marta@Example.com ']);
        $this->assertSame(200, $ok->status, json_encode($ok->body));
        $this->assertSame('marta@example.com', $ok->body['email']);
        $this->assertNull($owner->get("/customers/{$customer['id']}")->body['email']);
        Mail::assertSent(SaleReceiptMail::class, function (SaleReceiptMail $m) use ($shop, $sale) {
            $html = $m->render();
            $this->assertStringContainsString('Remera lisa', $html);
            $this->assertStringContainsString('Comprobante no válido como factura', $html);
            $this->assertStringContainsString('$ 2.400,00', $html);
            $this->assertNull($m->invoice);

            return $m->hasTo('marta@example.com') && $m->envelope()->from->name === $shop['input']['tradeName']
                && str_contains($m->envelope()->subject, "venta N° {$sale['number']}");
        });

        $owner->post("/sales/{$sale['id']}/email", ['email' => 'marta@example.com', 'saveToCustomer' => true]);
        $this->assertSame('marta@example.com', $owner->get("/customers/{$customer['id']}")->body['email']);
        $audit = json_encode($owner->get('/audit')->body);
        $this->assertStringContainsString('sale.emailed', $audit);

        // Una factura que no es de la venta no se manda.
        $this->assertSame(404, $owner->post("/sales/{$sale['id']}/email", ['email' => 'marta@example.com', 'invoiceId' => self::uuid()])->status);
    }

    public function test_el_cajero_manda_solo_sus_ventas(): void
    {
        $shop = $this->shop();
        $owner = $shop['client'];
        $product = $this->createProduct($owner, ['price' => '1200', 'initialStock' => '10']);
        $ownerSale = $this->sell($owner, $shop, $product);
        ['client' => $cashier] = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $shop['me']['branchIds']);
        $own = $this->sell($cashier, $shop, $product);

        $this->assertSame(200, $cashier->post("/sales/{$own['id']}/email", ['email' => 'cliente@example.com'])->status);
        $this->assertSame(404, $cashier->post("/sales/{$ownerSale['id']}/email", ['email' => 'cliente@example.com'])->status);
    }
}
