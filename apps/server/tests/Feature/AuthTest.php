<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class AuthTest extends TestCase
{
    public function test_registro_crea_comercio_propietario_sucursal_y_roles_con_sesion_iniciada(): void
    {
        ['client' => $client, 'me' => $me, 'input' => $input] = $this->registerTenant(['businessTypeCode' => 'ferreteria']);
        $this->assertSame($input['email'], $me['user']['email']);
        $this->assertSame($input['tradeName'], $me['tenant']['tradeName']);
        $this->assertSame('trial', $me['tenant']['status']);
        $this->assertSame('Propietario', $me['role']['name']);
        $this->assertContains('subscription.manage', $me['permissions']);
        $this->assertCount(1, $me['branchIds']);

        $tenant = $client->get('/tenant')->body;
        $this->assertSame('ferreteria', $tenant['businessTypeCode']);
        $this->assertFalse($tenant['settings']['allowNegativeStock']);
        $this->assertSame('inicial', $tenant['plan']['code']);

        $names = array_column($this->rolesOf($client), 'name');
        foreach (['Propietario', 'Administrador', 'Encargado', 'Cajero', 'Repositor', 'Vendedor', 'Responsable de compras', 'Contador'] as $name) {
            $this->assertContains($name, $names);
        }
    }

    public function test_registro_rechaza_email_repetido_cuit_invalido_contrasena_comun_y_rubro_inexistente(): void
    {
        ['input' => $input] = $this->registerTenant();
        $c = $this->client();
        $dup = $c->post('/auth/register', [...$input, 'tradeName' => 'Otro', 'email' => strtoupper($input['email'])]);
        $this->assertSame(409, $dup->status);
        $this->assertSame('EMAIL_IN_USE', $dup->body['code']);

        $badCuit = $c->post('/auth/register', [...$input, 'email' => self::uniqueEmail(), 'cuit' => '20-12345678-0']);
        $this->assertSame(400, $badCuit->status);
        $this->assertSame('cuit', $badCuit->body['details'][0]['path']);

        $weak = $c->post('/auth/register', [...$input, 'email' => self::uniqueEmail(), 'password' => '1234567890']);
        $this->assertSame(400, $weak->status);

        $short = $c->post('/auth/register', [...$input, 'email' => self::uniqueEmail(), 'password' => 'corta']);
        $this->assertSame(400, $short->status);
        $this->assertSame('La contraseña debe tener al menos 10 caracteres', $short->body['details'][0]['message']);

        $badType = $c->post('/auth/register', [...$input, 'email' => self::uniqueEmail(), 'businessTypeCode' => 'nave-espacial']);
        $this->assertSame(400, $badType->status);
    }

    public function test_no_permite_dos_comercios_activos_con_el_mismo_cuit(): void
    {
        $cuit = self::randomCuit();
        $this->registerTenant(['cuit' => substr($cuit, 0, 2).'-'.substr($cuit, 2, 8).'-'.substr($cuit, 10)]);
        $res = $this->client()->post('/auth/register', [
            'tradeName' => 'Copia', 'cuit' => $cuit, 'taxCondition' => 'responsable_inscripto', 'businessTypeCode' => 'kiosco',
            'ownerName' => 'Otra persona', 'email' => self::uniqueEmail(), 'password' => self::PASSWORD,
        ]);
        $this->assertSame(409, $res->status);
        $this->assertStringContainsString('CUIT', $res->body['message']);
    }

    public function test_inicia_y_cierra_sesion_y_la_sesion_cerrada_ya_no_sirve(): void
    {
        ['input' => $input] = $this->registerTenant();
        $c = $this->client();
        $this->assertSame(401, $c->get('/auth/me')->status);
        $this->assertSame(200, $c->post('/auth/login', ['login' => strtoupper($input['email']), 'password' => self::PASSWORD])->status);
        $this->assertSame($input['email'], $c->get('/auth/me')->body['user']['email']);

        $stolen = $c->cookies;
        $this->assertSame(200, $c->post('/auth/logout')->status);
        $replay = $this->client();
        $replay->cookies = $stolen;
        $this->assertSame(401, $replay->get('/auth/me')->status);
    }

    public function test_las_cookies_de_sesion_son_http_only_y_same_site(): void
    {
        ['input' => $input] = $this->registerTenant();
        $res = $this->client()->post('/auth/login', ['login' => $input['email'], 'password' => self::PASSWORD]);
        $byName = [];
        foreach ($res->cookies as $cookie) {
            $byName[$cookie->getName()] = $cookie;
        }
        $this->assertTrue($byName['gc_session']->isHttpOnly());
        $this->assertSame('lax', $byName['gc_session']->getSameSite());
        $this->assertFalse($byName['gc_csrf']->isHttpOnly(), 'la web necesita leer el token CSRF');
    }

    public function test_responde_igual_para_email_inexistente_y_contrasena_incorrecta(): void
    {
        ['input' => $input] = $this->registerTenant();
        $c = $this->client();
        $wrong = $c->post('/auth/login', ['login' => $input['email'], 'password' => 'otra-clave-incorrecta']);
        $missing = $c->post('/auth/login', ['login' => 'nadie@test.local', 'password' => 'otra-clave-incorrecta']);
        $this->assertSame(401, $wrong->status);
        $this->assertSame(401, $missing->status);
        $this->assertSame($missing->body['code'], $wrong->body['code']);
        $this->assertSame($missing->body['message'], $wrong->body['message']);
    }

    public function test_bloquea_tras_demasiados_intentos_fallidos(): void
    {
        ['input' => $input] = $this->registerTenant();
        $c = $this->client();
        $statuses = [];
        for ($i = 0; $i < 11; $i++) {
            $statuses[] = $c->post('/auth/login', ['login' => $input['email'], 'password' => 'incorrecta-123'])->status;
        }
        $this->assertSame(array_fill(0, 10, 401), array_slice($statuses, 0, 10));
        $this->assertSame(429, $statuses[10]);
    }

    public function test_exige_el_token_csrf_en_mutaciones(): void
    {
        ['client' => $client] = $this->registerTenant();
        $res = $client->post('/branches', ['name' => 'Sin token'], csrf: false);
        $this->assertSame(403, $res->status);
        $this->assertSame('CSRF_INVALID', $res->body['code']);
    }

    public function test_lista_sesiones_y_permite_cerrar_otra_sesion(): void
    {
        ['client' => $client, 'input' => $input] = $this->registerTenant();
        $other = $this->client();
        $other->post('/auth/login', ['login' => $input['email'], 'password' => self::PASSWORD]);
        $list = $client->get('/auth/sessions')->body;
        $this->assertCount(2, $list);
        $otherSession = collect($list)->firstWhere('current', false);
        $this->assertSame(200, $client->delete('/auth/sessions/'.$otherSession['id'])->status);
        $this->assertSame(401, $other->get('/auth/me')->status);
        $this->assertSame(200, $client->get('/auth/me')->status);
    }

    public function test_recupera_la_contrasena_con_enlace_de_un_solo_uso_y_cierra_sesiones(): void
    {
        ['client' => $client, 'input' => $input] = $this->registerTenant();
        $anon = $this->client();
        $this->assertSame(202, $anon->post('/auth/forgot-password', ['email' => $input['email']])->status);

        $token = null;
        Mail::assertSent(PasswordResetMail::class, function (PasswordResetMail $mail) use ($input, &$token) {
            if (! $mail->hasTo($input['email'])) {
                return false;
            }
            $this->assertStringContainsString('/restablecer?token=', $mail->link);
            $token = rawurldecode(explode('token=', $mail->link)[1]);

            return true;
        });

        $newPassword = 'nueva-clave-segura-2';
        $this->assertSame(200, $anon->post('/auth/reset-password', ['token' => $token, 'password' => $newPassword])->status);
        $reuse = $anon->post('/auth/reset-password', ['token' => $token, 'password' => 'otra-clave-segura-3']);
        $this->assertSame(400, $reuse->status);
        $this->assertSame('RESET_TOKEN_INVALID', $reuse->body['code']);

        $this->assertSame(401, $client->get('/auth/me')->status);
        $this->assertSame(401, $anon->post('/auth/login', ['login' => $input['email'], 'password' => self::PASSWORD])->status);
        $this->assertSame(200, $anon->post('/auth/login', ['login' => $input['email'], 'password' => $newPassword])->status);
    }

    public function test_recuperacion_responde_igual_si_el_email_no_existe_y_no_envia_correo(): void
    {
        $res = $this->client()->post('/auth/forgot-password', ['email' => 'inexistente@test.local']);
        $this->assertSame(202, $res->status);
        Mail::assertNothingSent();
    }

    public function test_cambia_la_contrasena_verificando_la_actual_y_cierra_las_otras_sesiones(): void
    {
        ['client' => $client, 'input' => $input] = $this->registerTenant();
        $other = $this->client();
        $other->post('/auth/login', ['login' => $input['email'], 'password' => self::PASSWORD]);
        $bad = $client->post('/auth/change-password', ['currentPassword' => 'no-es-esta-1', 'newPassword' => 'nueva-clave-segura-9']);
        $this->assertSame(400, $bad->status);
        $this->assertSame('INVALID_PASSWORD', $bad->body['code']);
        $this->assertSame(200, $client->post('/auth/change-password', ['currentPassword' => self::PASSWORD, 'newPassword' => 'nueva-clave-segura-9'])->status);
        $this->assertSame(200, $client->get('/auth/me')->status);
        $this->assertSame(401, $other->get('/auth/me')->status);
    }

    public function test_la_contrasena_no_se_recorta(): void
    {
        $password = '  clave con espacios  ';
        ['input' => $input] = $this->registerTenant(['password' => $password]);
        $c = $this->client();
        $this->assertSame(401, $c->post('/auth/login', ['login' => $input['email'], 'password' => trim($password)])->status);
        $this->assertSame(200, $c->post('/auth/login', ['login' => $input['email'], 'password' => $password])->status);
    }
}
