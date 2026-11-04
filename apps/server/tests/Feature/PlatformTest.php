<?php

namespace Tests\Feature;

use App\Mail\OwnerInvitationMail;
use App\Models\PlatformUser;
use App\Services\PasswordService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Mail;
use Tests\Support\ApiClient;
use Tests\TestCase;

class PlatformTest extends TestCase
{
    private const ADMIN_PASSWORD = 'clave-de-plataforma-segura';

    private string $email;

    protected function setUp(): void
    {
        parent::setUp();
        $this->email = self::uniqueEmail('admin');
        PlatformUser::create([
            'email' => $this->email,
            'name' => 'Admin Plataforma',
            'password_hash' => app(PasswordService::class)->hash(self::ADMIN_PASSWORD),
        ]);
    }

    private function platformLogin(): ApiClient
    {
        $c = $this->client();
        $res = $c->post('/platform/auth/login', ['email' => $this->email, 'password' => self::ADMIN_PASSWORD]);
        $this->assertSame(200, $res->status, json_encode($res->body));

        return $c;
    }

    public function test_entra_con_email_y_contrasena(): void
    {
        $c = $this->client();
        $this->assertSame(401, $c->post('/platform/auth/login', ['email' => $this->email, 'password' => 'incorrecta-123'])->status);
        $this->assertSame(401, $c->post('/platform/auth/login', ['email' => self::uniqueEmail('nadie'), 'password' => self::ADMIN_PASSWORD])->status);

        $ok = $this->platformLogin();
        $this->assertSame('Admin Plataforma', $ok->get('/platform/auth/me')->body['name']);
        // La sesión de plataforma no sirve para operar un comercio.
        $this->assertSame(401, $ok->get('/tenant')->status);
        $this->assertSame(200, $ok->post('/platform/auth/logout')->status);
        $this->assertSame(401, $ok->get('/platform/auth/me')->status);
    }

    public function test_lista_comercios_con_uso_agregado(): void
    {
        ['tenantId' => $tenantId] = $this->registerTenant(['tradeName' => 'Visible en plataforma '.random_int(0, 99999)]);
        $admin = $this->platformLogin();
        $res = $admin->get('/platform/tenants?q='.rawurlencode('Visible en plataforma').'&pageSize=100');
        $this->assertSame(200, $res->status);
        $row = collect($res->body['items'])->firstWhere('id', $tenantId);
        $this->assertSame(1, $row['userCount']);
        $this->assertSame(1, $row['branchCount']);
        $this->assertSame('inicial', $row['planCode']);
        $this->assertSame('trialing', $row['subscriptionStatus']);
        $this->assertNotNull($row['trialEndsAt']);

        $filtered = $admin->get('/platform/tenants?status=suspended&pageSize=100')->body['items'];
        $this->assertNotContains($tenantId, array_column($filtered, 'id'));
    }

    public function test_suspende_y_reactiva_un_comercio_que_lo_ve_en_su_auditoria(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        $admin = $this->platformLogin();
        $this->assertSame(200, $admin->post("/platform/tenants/{$tenantId}/status", ['status' => 'suspended', 'reason' => 'Falta de pago'])->status);

        $blocked = $owner->get('/tenant');
        $this->assertSame(403, $blocked->status);
        $this->assertSame('TENANT_SUSPENDED', $blocked->body['code']);
        $this->assertSame(200, $owner->get('/auth/me')->status);

        $admin->post("/platform/tenants/{$tenantId}/status", ['status' => 'active', 'reason' => 'Pago acreditado']);
        $this->assertSame(200, $owner->get('/tenant')->status);
        $actions = array_column($owner->get('/audit?entityType=tenant')->body['items'], 'action');
        $this->assertContains('platform.tenant_suspended', $actions);
        $this->assertContains('platform.tenant_activated', $actions);
    }

    public function test_edita_precio_limites_y_funciones_de_un_plan_con_auditoria(): void
    {
        $admin = $this->platformLogin();
        $pro = collect($admin->get('/platform/plans')->body)->firstWhere('code', 'profesional');
        $res = $admin->put("/platform/plans/{$pro['id']}", [
            'name' => 'Profesional', 'price' => '24999.90', 'trialDays' => 30, 'active' => true,
            'limits' => [...$pro['limits'], 'max_users' => 12], 'features' => ['fiscal_arca', 'advanced_reports'],
        ]);
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame('24999.90', $res->body['price']);
        $this->assertSame(30, $res->body['trialDays']);
        $this->assertSame(12, $res->body['limits']['max_users']);
        $this->assertSame(['advanced_reports', 'fiscal_arca'], $res->body['features']);
        $this->assertContains('platform.plan_updated', array_column($admin->get('/platform/audit')->body['items'], 'action'));
    }

    public function test_valida_los_datos_del_plan(): void
    {
        $admin = $this->platformLogin();
        $plan = $admin->get('/platform/plans')->body[0];
        $res = $admin->put("/platform/plans/{$plan['id']}", ['name' => 'x', 'price' => '12,50', 'trialDays' => -1, 'active' => true, 'limits' => [], 'features' => []]);
        $this->assertSame(400, $res->status);
        $this->assertEqualsCanonicalizing(['price', 'trialDays'], array_column($res->body['details'], 'path'));
        $unknown = $admin->put("/platform/plans/{$plan['id']}", ['name' => 'x', 'price' => '1', 'trialDays' => 1, 'active' => true, 'limits' => ['max_naves' => 1], 'features' => []]);
        $this->assertSame('limits.max_naves', $unknown->body['details'][0]['path']);
    }

    public function test_el_comando_crea_un_operador_que_puede_entrar(): void
    {
        $email = self::uniqueEmail('op');
        putenv('PLATFORM_ADMIN_PASSWORD=otra-clave-de-operador');
        try {
            $this->assertSame(0, Artisan::call('platform:create-admin', ['email' => $email, 'name' => 'Operadora']));
            $this->assertSame(1, Artisan::call('platform:create-admin', ['email' => $email, 'name' => 'Repetida']));
        } finally {
            putenv('PLATFORM_ADMIN_PASSWORD');
        }
        $res = $this->client()->post('/platform/auth/login', ['email' => $email, 'password' => 'otra-clave-de-operador']);
        $this->assertSame(200, $res->status);
    }

    /** @return array<string, mixed> */
    private function newTenantInput(array $overrides = []): array
    {
        return array_merge([
            'tradeName' => 'Kiosco dado de alta '.random_int(0, 999999),
            'taxCondition' => 'monotributo',
            'businessTypeCode' => 'kiosco',
            'planCode' => 'profesional',
            'ownerName' => 'Dueño Invitado',
            'ownerEmail' => self::uniqueEmail('invitado'),
        ], $overrides);
    }

    public function test_da_de_alta_un_comercio_y_el_dueno_entra_con_la_invitacion(): void
    {
        $admin = $this->platformLogin();
        $input = $this->newTenantInput();
        $res = $admin->post('/platform/tenants', $input);
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertTrue($res->body['ownerInvited']);
        $this->assertTrue($res->body['invitationSent']);
        $tenantId = $res->body['id'];

        $link = null;
        Mail::assertSent(OwnerInvitationMail::class, function (OwnerInvitationMail $m) use ($input, &$link) {
            $link = $m->link;

            return $m->hasTo($input['ownerEmail']) && $m->tradeName === $input['tradeName'];
        });
        parse_str((string) parse_url((string) $link, PHP_URL_QUERY), $query);

        // Antes de aceptar la invitación no hay contraseña que sirva.
        $owner = $this->client();
        $this->assertSame(401, $owner->post('/auth/login', ['login' => $input['ownerEmail'], 'password' => self::PASSWORD])->status);
        $this->assertSame(200, $owner->post('/auth/reset-password', ['token' => $query['token'], 'password' => self::PASSWORD])->status);
        $this->assertSame(200, $owner->post('/auth/login', ['login' => $input['ownerEmail'], 'password' => self::PASSWORD])->status);

        $me = $owner->get('/auth/me')->body;
        $this->assertSame($tenantId, $me['tenant']['id']);
        $this->assertSame('Propietario', $me['role']['name']);
        $this->assertSame(200, $owner->get('/branches')->status);

        $row = collect($admin->get('/platform/tenants?pageSize=100&q='.rawurlencode($input['tradeName']))->body['items'])->firstWhere('id', $tenantId);
        $this->assertSame('profesional', $row['planCode']);
        $created = collect($owner->get('/audit?entityType=tenant')->body['items'])->firstWhere('action', 'tenant.created');
        $this->assertSame('Plataforma: Admin Plataforma', $created['actorName']);
        $this->assertContains('tenant.created', array_column($admin->get('/platform/audit')->body['items'], 'action'));
    }

    public function test_si_el_dueno_ya_tiene_cuenta_suma_el_comercio_sin_invitacion(): void
    {
        ['client' => $owner, 'input' => $existing] = $this->registerTenant();
        $admin = $this->platformLogin();
        $res = $admin->post('/platform/tenants', $this->newTenantInput(['ownerEmail' => strtoupper($existing['email'])]));
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertFalse($res->body['ownerInvited']);
        Mail::assertNotSent(OwnerInvitationMail::class);

        $tenantIds = array_column($owner->get('/auth/me')->body['memberships'], 'tenantId');
        $this->assertContains($res->body['id'], $tenantIds);
        $this->assertCount(2, $tenantIds);
    }

    public function test_crea_dueno_con_contrasena_inicial_sin_necesitar_correo(): void
    {
        $admin = $this->platformLogin();
        // Los espacios forman parte de la contraseña: no deben recortarse.
        $password = ' clave-inicial-del-kiosco ';
        $input = $this->newTenantInput(['ownerPassword' => $password]);
        $res = $admin->post('/platform/tenants', $input);
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertTrue($res->body['ownerPasswordSet']);
        $this->assertFalse($res->body['ownerInvited']);
        $this->assertFalse($res->body['invitationSent']);
        Mail::assertNotSent(OwnerInvitationMail::class);
        $owner = $this->client();
        $this->assertSame(200, $owner->post('/auth/login', ['login' => $input['ownerEmail'], 'password' => $password])->status);
        $me = $owner->get('/auth/me')->body;
        $this->assertSame($res->body['id'], $me['tenant']['id']);
        $this->assertSame('Propietario', $me['role']['name']);
        $audit = $owner->get('/audit?entityType=tenant')->body;
        $this->assertStringNotContainsString($password, json_encode($audit));
        $this->assertStringNotContainsString('ownerPassword', json_encode($audit));
    }

    public function test_no_reemplaza_la_contrasena_de_un_dueno_existente(): void
    {
        ['input' => $existing] = $this->registerTenant();
        $admin = $this->platformLogin();
        $input = $this->newTenantInput(['ownerEmail' => $existing['email'], 'ownerPassword' => 'otra-clave-del-kiosco']);
        $res = $admin->post('/platform/tenants', $input);
        $this->assertSame(400, $res->status);
        $this->assertSame('ownerPassword', $res->body['details'][0]['path']);
        $owner = $this->client();
        $this->assertSame(200, $owner->post('/auth/login', ['login' => $existing['email'], 'password' => $existing['password']])->status);
        $this->assertCount(1, $owner->get('/auth/me')->body['memberships']);
    }

    public function test_valida_la_contrasena_inicial_antes_de_crear_el_comercio(): void
    {
        $admin = $this->platformLogin();
        foreach (['corta', str_repeat('x', 129), '1234567890', 'password123'] as $password) {
            $res = $admin->post('/platform/tenants', $this->newTenantInput(['ownerPassword' => $password]));
            $this->assertSame(400, $res->status);
            $this->assertSame('ownerPassword', $res->body['details'][0]['path']);
        }
    }

    public function test_valida_el_alta_manual(): void
    {
        $admin = $this->platformLogin();
        $res = $admin->post('/platform/tenants', $this->newTenantInput(['planCode' => 'no-existe', 'ownerEmail' => 'sin-arroba', 'tradeName' => '']));
        $this->assertSame(400, $res->status);
        $this->assertEqualsCanonicalizing(['planCode', 'ownerEmail', 'tradeName'], array_column($res->body['details'], 'path'));

        $rubro = $admin->post('/platform/tenants', $this->newTenantInput(['businessTypeCode' => 'nave-espacial']));
        $this->assertSame('businessTypeCode', $rubro->body['details'][0]['path']);

        // Un usuario de comercio no puede usar la ruta de plataforma.
        ['client' => $owner] = $this->registerTenant();
        $this->assertSame(401, $owner->post('/platform/tenants', $this->newTenantInput())->status);
    }

    public function test_reasigna_plan_sin_reiniciar_prueba_y_controla_ediciones_simultaneas(): void
    {
        ['client' => $owner, 'tenantId' => $id] = $this->registerTenant();
        $admin = $this->platformLogin();
        $before = collect($admin->get('/platform/tenants?pageSize=100')->body['items'])->firstWhere('id', $id);
        $this->assertSame(200, $admin->post("/platform/tenants/{$id}/plan", ['planCode' => 'multisucursal', 'expectedPlanCode' => 'inicial', 'reason' => 'Ampliación solicitada'])->status);
        $this->assertSame('multisucursal', $owner->get('/tenant')->body['plan']['code']);
        $after = collect($admin->get('/platform/tenants?pageSize=100')->body['items'])->firstWhere('id', $id);
        $this->assertSame($before['trialEndsAt'], $after['trialEndsAt']);
        $this->assertSame($before['subscriptionStatus'], $after['subscriptionStatus']);
        $this->assertSame(409, $admin->post("/platform/tenants/{$id}/plan", ['planCode' => 'inicial', 'expectedPlanCode' => 'inicial', 'reason' => 'Edición desactualizada'])->status);
        $this->assertSame(201, $owner->post('/branches', ['name' => 'Segunda sucursal', 'address' => null])->status);
        $denied = $admin->post("/platform/tenants/{$id}/plan", ['planCode' => 'inicial', 'expectedPlanCode' => 'multisucursal', 'reason' => 'Baja de plan']);
        $this->assertSame([409, 'PLAN_USAGE_EXCEEDED'], [$denied->status, $denied->body['code']]);
        $this->assertContains('platform.tenant_plan_changed', array_column($owner->get('/audit?entityType=tenant')->body['items'], 'action'));
    }
}
