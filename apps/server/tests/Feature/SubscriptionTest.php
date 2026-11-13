<?php

namespace Tests\Feature;

use App\Mail\SubscriptionNoticeMail;
use App\Models\Plan;
use App\Models\PlanLimit;
use App\Models\PlatformUser;
use App\Models\Subscription;
use App\Services\BillingService;
use App\Services\PasswordService;
use App\Tenancy\TenantContext;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Cobro de suscripciones (ADR 0012). La API de Mercado Pago se simula; la base es la real. */
class SubscriptionTest extends TestCase
{
    /** Pagos que "conoce" Mercado Pago en la simulación, por número. @var array<string, array<string, mixed>> */
    private array $mpPayments = [];

    /** @var list<array<string, mixed>> */
    private array $preferences = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.mercadopago.access_token' => 'TEST-123', 'services.mercadopago.webhook_secret' => '']);
        Http::preventStrayRequests();
        Http::fake(function (Request $request) {
            $url = $request->url();
            if (str_ends_with($url, '/checkout/preferences')) {
                $this->preferences[] = $request->data();

                return Http::response(['id' => 'pref-'.count($this->preferences), 'init_point' => 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1'], 201);
            }
            if (str_contains($url, '/v1/payments/search')) {
                parse_str((string) parse_url($url, PHP_URL_QUERY), $q);

                return Http::response(['results' => array_values(array_filter($this->mpPayments, fn ($p) => $p['external_reference'] === $q['external_reference']))]);
            }
            if (preg_match('#/v1/payments/(\d+)$#', $url, $m)) {
                return isset($this->mpPayments[$m[1]]) ? Http::response($this->mpPayments[$m[1]]) : Http::response(['message' => 'Payment not found'], 404);
            }

            return Http::response(['message' => 'ruta no simulada'], 500);
        });
    }

    private function pricedPlan(string $price = '15000.00', array $limits = []): Plan
    {
        $plan = Plan::create(['code' => 'pago-'.random_int(0, 999999999), 'name' => 'Con precio', 'price' => $price, 'sort_order' => 50]);
        $limits += ['max_branches' => 1, 'max_users' => 3, 'max_products' => 2000, 'max_registers' => 1];
        PlanLimit::insert(array_map(fn ($k, $v) => ['plan_id' => $plan->id, 'key' => $k, 'value' => $v], array_keys($limits), $limits));

        return $plan;
    }

    private function setSubscription(string $tenantId, array $values): void
    {
        app(TenantContext::class)->run($tenantId, fn () => Subscription::query()->update($values));
    }

    /** Comercio con un plan pago y la prueba vencida hace $daysAgo días (negativo: vence en el futuro). */
    private function payingTenant(int $daysAgo = -10, string $price = '15000.00'): array
    {
        $t = $this->registerTenant();
        $t['plan'] = $this->pricedPlan($price);
        $this->setSubscription($t['tenantId'], ['plan_id' => $t['plan']->id, 'trial_ends_at' => Carbon::now()->subDays($daysAgo)]);

        return $t;
    }

    private function mpPayment(string $id, string $reference, string $status = 'approved', float $amount = 45000.0, string $currency = 'ARS'): void
    {
        $this->mpPayments[$id] = [
            'id' => (int) $id, 'status' => $status, 'status_detail' => 'accredited', 'external_reference' => $reference,
            'transaction_amount' => $amount, 'currency_id' => $currency, 'payment_method_id' => 'visa', 'date_approved' => Carbon::now()->toIso8601String(),
        ];
    }

    private function notify(string $mpId, array $headers = []): int
    {
        $server = ['REMOTE_ADDR' => '10.200.0.1', 'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        foreach ($headers as $k => $v) {
            $server['HTTP_'.strtoupper(str_replace('-', '_', $k))] = $v;
        }

        return $this->call('POST', '/api/v1/mercadopago/webhook?data.id='.$mpId.'&type=payment', [], [], [], $server, json_encode(['type' => 'payment', 'data' => ['id' => $mpId]]))->getStatusCode();
    }

    private static function assertSameMoment(string $expected, ?string $actual): void
    {
        self::assertNotNull($actual);
        self::assertLessThan(5, abs(Carbon::parse($expected)->diffInSeconds(Carbon::parse($actual))), "{$expected} ≠ {$actual}");
    }

    private function platformAdmin(): ApiClient
    {
        $email = self::uniqueEmail('admin');
        PlatformUser::create(['email' => $email, 'name' => 'Operador', 'password_hash' => app(PasswordService::class)->hash('clave-de-plataforma-segura')]);
        $c = $this->client();
        $this->assertSame(200, $c->post('/platform/auth/login', ['email' => $email, 'password' => 'clave-de-plataforma-segura'])->status);

        return $c;
    }

    public function test_informa_el_estado_y_pausa_el_comercio_pasada_la_gracia(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId, 'me' => $me] = $t = $this->payingTenant(-5);
        $this->assertSame('trial', $owner->get('/auth/me')->body['subscription']['state']);

        $this->setSubscription($tenantId, ['trial_ends_at' => Carbon::now()->subDays(2)]);
        $this->assertSame('grace', $owner->get('/auth/me')->body['subscription']['state']);
        $this->assertSame(200, $owner->get('/products')->status);

        $cashier = $this->addEmployee($owner, $this->roleByTemplate($owner, 'cashier')['id'], $me['branchIds'])['client'];
        $this->setSubscription($tenantId, ['trial_ends_at' => Carbon::now()->subDays(BillingService::GRACE_DAYS + 1)]);
        $blocked = $owner->get('/products');
        $this->assertSame(402, $blocked->status);
        $this->assertSame('SUBSCRIPTION_EXPIRED', $blocked->body['code']);
        $this->assertSame('expired', $owner->get('/auth/me')->body['subscription']['state']);
        // Quien gestiona la suscripción puede verla y pagarla; el resto solo ve que está pausada.
        $this->assertSame(200, $owner->get('/subscription')->status);
        $this->assertSame(402, $cashier->post('/sales', [])->status);
        $this->assertSame(403, $cashier->get('/subscription')->status);
        $this->assertSame('expired', $cashier->get('/auth/me')->body['subscription']['state']);
        $this->assertSame($t['plan']->code, $owner->get('/subscription')->body['plan']['code']);
    }

    public function test_un_plan_sin_precio_o_una_licencia_sin_vencimiento_no_se_cobran(): void
    {
        ['client' => $free, 'tenantId' => $freeId] = $this->registerTenant();
        $this->setSubscription($freeId, ['trial_ends_at' => Carbon::now()->subYear()]);
        $this->assertSame('free', $free->get('/auth/me')->body['subscription']['state']);
        $this->assertSame(200, $free->get('/products')->status);

        ['client' => $owner, 'tenantId' => $tenantId] = $this->payingTenant(30);
        $this->assertSame(402, $owner->get('/products')->status);
        $admin = $this->platformAdmin();
        $this->assertSame(400, $admin->post("/platform/tenants/{$tenantId}/license", ['freeForever' => 'si', 'reason' => 'Amigo'])->status);
        $this->assertSame(200, $admin->post("/platform/tenants/{$tenantId}/license", ['freeForever' => true, 'reason' => 'Licencia de cortesía'])->status);
        $state = $owner->get('/auth/me')->body['subscription'];
        $this->assertSame('free', $state['state']);
        $this->assertTrue($state['freeForever']);
        $this->assertSame(200, $owner->get('/products')->status);
        $this->assertSame('SUBSCRIPTION_FREE', $owner->post('/subscription/checkout', ['planCode' => app(TenantContext::class)->run($tenantId, fn () => Plan::find(Subscription::first()->plan_id)->code), 'months' => 1])->body['code']);
        $row = collect($admin->get('/platform/tenants?pageSize=100')->body['items'])->firstWhere('id', $tenantId);
        $this->assertTrue($row['freeForever']);
        $this->assertSame('free', $row['billingState']);
        $this->assertContains('platform.tenant_license_changed', array_column($owner->get('/audit?pageSize=100')->body['items'], 'action'));
    }

    public function test_paga_con_mercado_pago_y_corre_el_vencimiento_desde_el_fin_de_la_prueba(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId, 'plan' => $plan] = $this->payingTenant(-10);
        $trialEnd = $owner->get('/auth/me')->body['subscription']['dueAt'];
        $this->assertSame(400, $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 2])->status);

        $res = $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 3]);
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertStringStartsWith('https://www.mercadopago.com.ar/', $res->body['url']);
        $reference = BillingService::reference($tenantId, $res->body['id']);
        $pref = $this->preferences[0];
        $this->assertSame($reference, $pref['external_reference']);
        $this->assertEquals(45000, $pref['items'][0]['unit_price']);
        $this->assertSame('ARS', $pref['items'][0]['currency_id']);
        $this->assertStringContainsString('/app/suscripcion?pago='.$res->body['id'], $pref['back_urls']['success']);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/checkout/preferences') && $r->hasHeader('Authorization', 'Bearer TEST-123') && $r->hasHeader('X-Idempotency-Key', $reference));

        $this->mpPayment('9001', $reference);
        $this->assertSame(200, $this->notify('9001'));
        $state = $owner->get('/subscription')->body;
        $this->assertSame('active', $state['state']);
        self::assertSameMoment(Carbon::parse($trialEnd)->addMonthsNoOverflow(3)->toIso8601String(), $state['dueAt']);
        $this->assertSame('approved', $state['payments'][0]['status']);
        $this->assertSame('45000.00', $state['payments'][0]['amount']);
        $this->assertSame('active', $owner->get('/auth/me')->body['tenant']['status']);

        // Un aviso repetido no vuelve a sumar meses.
        $this->assertSame(200, $this->notify('9001'));
        $this->assertSame($state['dueAt'], $owner->get('/subscription')->body['dueAt']);
        $paid = array_values(array_filter($owner->get('/audit?pageSize=100')->body['items'], fn ($a) => $a['action'] === 'subscription.paid'));
        $this->assertCount(1, $paid);
        $this->assertSame('Mercado Pago', $paid[0]['actorName']);
    }

    public function test_rechaza_un_pago_por_menos_o_en_otra_moneda_y_avisos_de_otros_sistemas(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId, 'plan' => $plan] = $this->payingTenant(-10);
        $before = $owner->get('/auth/me')->body['subscription']['dueAt'];
        $id = $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 1])->body['id'];
        $reference = BillingService::reference($tenantId, $id);

        $this->mpPayment('9101', $reference, amount: 100.0);
        $this->assertSame(200, $this->notify('9101'));
        $this->mpPayment('9102', $reference, amount: 15000.0, currency: 'USD');
        $this->assertSame(200, $this->notify('9102'));
        $this->mpPayment('9103', 'GI-55');
        $this->assertSame(200, $this->notify('9103'));
        $this->assertSame(200, $this->notify('9999'));

        $this->assertSame($before, $owner->get('/auth/me')->body['subscription']['dueAt']);
        $this->assertSame('trial', $owner->get('/auth/me')->body['subscription']['state']);
        $this->assertSame('rejected', $owner->post("/subscription/payments/{$id}/check", ['mpPaymentId' => null])->body['status']);
    }

    public function test_al_volver_del_pago_concilia_por_la_referencia_y_un_reembolso_descuenta_los_meses(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId, 'plan' => $plan] = $this->payingTenant(-3);
        $trialEnd = $owner->get('/auth/me')->body['subscription']['dueAt'];
        $id = $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 1])->body['id'];
        $this->assertSame('pending', $owner->post("/subscription/payments/{$id}/check", ['mpPaymentId' => null])->body['status']);

        // El aviso no llegó: la vuelta del navegador encuentra el pago buscando por la referencia.
        $this->mpPayment('9201', BillingService::reference($tenantId, $id), 'rejected', 15000.0);
        $this->mpPayment('9202', BillingService::reference($tenantId, $id), 'approved', 15000.0);
        $check = $owner->post("/subscription/payments/{$id}/check", ['mpPaymentId' => null]);
        $this->assertSame(200, $check->status, json_encode($check->body));
        $this->assertSame('approved', $check->body['status']);
        self::assertSameMoment(Carbon::parse($trialEnd)->addMonthNoOverflow()->toIso8601String(), $owner->get('/auth/me')->body['subscription']['dueAt']);
        // Un aviso viejo del intento rechazado no lo vuelve atrás.
        $this->assertSame(200, $this->notify('9201'));
        $this->assertSame('active', $owner->get('/auth/me')->body['subscription']['state']);

        $this->mpPayments['9202']['status'] = 'refunded';
        $this->assertSame(200, $this->notify('9202'));
        self::assertSameMoment($trialEnd, $owner->get('/auth/me')->body['subscription']['dueAt']);
        $this->assertSame('refunded', $owner->get('/subscription')->body['payments'][0]['status']);
        $this->assertContains('subscription.payment_refunded', array_column($owner->get('/audit?pageSize=100')->body['items'], 'action'));
    }

    public function test_si_estaba_pausado_el_periodo_pagado_arranca_hoy(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId, 'plan' => $plan] = $this->payingTenant(40);
        $this->assertSame(402, $owner->get('/products')->status);
        $id = $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 1])->body['id'];
        $this->mpPayment('9301', BillingService::reference($tenantId, $id), amount: 15000.0);
        $this->assertSame('approved', $owner->post("/subscription/payments/{$id}/check", ['mpPaymentId' => '9301'])->body['status']);
        self::assertSameMoment(Carbon::now()->addMonthNoOverflow()->toIso8601String(), $owner->get('/auth/me')->body['subscription']['dueAt']);
        $this->assertSame(200, $owner->get('/products')->status);
    }

    public function test_no_permite_pagarse_a_un_plan_que_no_alcanza_para_el_uso_actual(): void
    {
        ['client' => $owner] = $this->payingTenant(-10);
        $small = $this->pricedPlan('5000.00', ['max_users' => 0]);
        $res = $owner->post('/subscription/checkout', ['planCode' => $small->code, 'months' => 1]);
        $this->assertSame(409, $res->status);
        $this->assertSame('PLAN_USAGE_EXCEEDED', $res->body['code']);
        $this->assertSame([], $this->preferences);
    }

    public function test_sin_credencial_de_mercado_pago_no_ofrece_pagar(): void
    {
        config(['services.mercadopago.access_token' => '']);
        ['client' => $owner, 'plan' => $plan] = $this->payingTenant(-10);
        $this->assertFalse($owner->get('/subscription')->body['mercadoPago']);
        $this->assertSame('MP_NOT_CONFIGURED', $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 1])->body['code']);
    }

    public function test_con_clave_de_avisos_rechaza_firmas_invalidas(): void
    {
        config(['services.mercadopago.webhook_secret' => 'clave-de-avisos']);
        ['client' => $owner, 'tenantId' => $tenantId, 'plan' => $plan] = $this->payingTenant(-10);
        $id = $owner->post('/subscription/checkout', ['planCode' => $plan->code, 'months' => 1])->body['id'];
        $this->mpPayment('9401', BillingService::reference($tenantId, $id), amount: 15000.0);

        $this->assertSame(401, $this->notify('9401', ['x-signature' => 'ts=1,v1=falsa', 'x-request-id' => 'abc']));
        $this->assertSame('trial', $owner->get('/auth/me')->body['subscription']['state']);
        $v1 = hash_hmac('sha256', 'id:9401;request-id:abc;ts:1700000000;', 'clave-de-avisos');
        $this->assertSame(200, $this->notify('9401', ['x-signature' => "ts=1700000000,v1={$v1}", 'x-request-id' => 'abc']));
        $this->assertSame('active', $owner->get('/auth/me')->body['subscription']['state']);
    }

    public function test_el_operador_registra_un_pago_por_transferencia(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->payingTenant(-2);
        $trialEnd = $owner->get('/auth/me')->body['subscription']['dueAt'];
        $admin = $this->platformAdmin();
        $this->assertSame(400, $admin->post("/platform/tenants/{$tenantId}/payments", ['months' => 0, 'amount' => '1', 'notes' => 'x'])->status);
        $res = $admin->post("/platform/tenants/{$tenantId}/payments", ['months' => 6, 'amount' => '90000', 'notes' => 'Transferencia del 28/10']);
        $this->assertSame(201, $res->status, json_encode($res->body));
        self::assertSameMoment(Carbon::parse($trialEnd)->addMonthsNoOverflow(6)->toIso8601String(), $owner->get('/auth/me')->body['subscription']['dueAt']);
        $history = $owner->get('/subscription')->body['payments'];
        $this->assertSame(['manual', '90000.00'], [$history[0]['method'], $history[0]['amount']]);
        $paid = collect($owner->get('/audit?pageSize=100')->body['items'])->firstWhere('action', 'subscription.paid');
        $this->assertStringStartsWith('Plataforma: ', $paid['actorName']);
        $this->assertSame('Transferencia del 28/10', $paid['after']['notes']);
    }

    public function test_avisa_por_correo_antes_y_despues_del_vencimiento_una_vez_por_etapa(): void
    {
        config(['services.mercadopago.access_token' => '']);
        ['tenantId' => $tenantId, 'input' => $input] = $this->payingTenant(-5);
        $sent = fn (string $stage) => Mail::sent(SubscriptionNoticeMail::class, fn ($m) => $m->hasTo($input['email']) && $m->stage === $stage)->count();

        Artisan::call('subscriptions:remind');
        Artisan::call('subscriptions:remind');
        $this->assertSame(1, $sent('d7'));

        $this->setSubscription($tenantId, ['trial_ends_at' => Carbon::now()->addHours(20)]);
        Artisan::call('subscriptions:remind');
        Artisan::call('subscriptions:remind');
        $this->assertSame(1, $sent('d1'));
        $this->assertSame(0, $sent('d3'));

        $this->setSubscription($tenantId, ['trial_ends_at' => Carbon::now()->subDay()]);
        Artisan::call('subscriptions:remind');
        $this->assertSame(1, $sent('due'));

        $this->setSubscription($tenantId, ['trial_ends_at' => Carbon::now()->subDays(BillingService::GRACE_DAYS + 1)]);
        Artisan::call('subscriptions:remind');
        Artisan::call('subscriptions:remind');
        $this->assertSame(1, $sent('paused'));
        $mail = Mail::sent(SubscriptionNoticeMail::class, fn ($m) => $m->hasTo($input['email']) && $m->stage === 'paused')->first();
        $this->assertStringEndsWith('/app/suscripcion', $mail->link);
        $this->assertStringContainsString('Pausamos el acceso', $mail->envelope()->subject);
    }
}
