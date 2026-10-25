<?php

namespace Tests\Feature;

use App\Models\PlatformUser;
use App\Services\PasswordService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\ApiClient;
use Tests\TestCase;

class PlatformTest extends TestCase
{
    private const ADMIN_PASSWORD = 'clave-de-plataforma-segura';

    private string $secret;

    private string $email;

    protected function setUp(): void
    {
        parent::setUp();
        $this->secret = (new Google2FA)->generateSecretKey(32);
        $this->email = self::uniqueEmail('admin');
        PlatformUser::create([
            'email' => $this->email,
            'name' => 'Admin Plataforma',
            'password_hash' => app(PasswordService::class)->hash(self::ADMIN_PASSWORD),
            'totp_secret_enc' => Crypt::encryptString($this->secret),
        ]);
    }

    private function platformLogin(): ApiClient
    {
        $c = $this->client();
        $res = $c->post('/platform/auth/login', ['email' => $this->email, 'password' => self::ADMIN_PASSWORD, 'totp' => (new Google2FA)->getCurrentOtp($this->secret)]);
        $this->assertSame(200, $res->status, json_encode($res->body));

        return $c;
    }

    public function test_exige_contrasena_y_codigo_totp(): void
    {
        $c = $this->client();
        $current = (new Google2FA)->getCurrentOtp($this->secret);
        $wrongCode = str_pad((string) (((int) $current + 500000) % 1000000), 6, '0', STR_PAD_LEFT);
        $this->assertSame(401, $c->post('/platform/auth/login', ['email' => $this->email, 'password' => self::ADMIN_PASSWORD, 'totp' => $wrongCode])->status);
        $this->assertSame(401, $c->post('/platform/auth/login', ['email' => $this->email, 'password' => 'incorrecta-123', 'totp' => $current])->status);
        $this->assertSame(400, $c->post('/platform/auth/login', ['email' => $this->email, 'password' => self::ADMIN_PASSWORD, 'totp' => '12ab56'])->status);

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

    public function test_el_comando_crea_un_operador_con_secreto_totp(): void
    {
        $email = self::uniqueEmail('op');
        putenv('PLATFORM_ADMIN_PASSWORD=otra-clave-de-operador');
        try {
            $this->assertSame(0, Artisan::call('platform:create-admin', ['email' => $email, 'name' => 'Operadora']));
        } finally {
            putenv('PLATFORM_ADMIN_PASSWORD');
        }
        $output = Artisan::output();
        $this->assertMatchesRegularExpression('/Clave manual: ([A-Z2-7]{32})/', $output);
        $this->assertStringContainsString('otpauth://totp/', $output);
        preg_match('/Clave manual: ([A-Z2-7]{32})/', $output, $m);
        $res = $this->client()->post('/platform/auth/login', ['email' => $email, 'password' => 'otra-clave-de-operador', 'totp' => (new Google2FA)->getCurrentOtp($m[1])]);
        $this->assertSame(200, $res->status);
    }
}
