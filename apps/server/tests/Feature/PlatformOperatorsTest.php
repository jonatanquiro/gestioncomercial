<?php

namespace Tests\Feature;

use App\Models\PlatformUser;
use App\Services\PasswordService;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Operadores del panel de plataforma (ADR 0027): alta, clave y desactivación desde el panel. */
class PlatformOperatorsTest extends TestCase
{
    private const ADMIN_PASSWORD = 'Plataforma-Segura-2026';

    private function login(string $email, string $password = self::ADMIN_PASSWORD): ApiClient
    {
        $c = $this->client();
        $res = $c->post('/platform/auth/login', ['email' => $email, 'password' => $password]);
        $this->assertSame(200, $res->status, json_encode($res->body));

        return $c;
    }

    public function test_alta_clave_y_desactivacion(): void
    {
        PlatformUser::create(['email' => $email = self::uniqueEmail('admin'), 'name' => 'Admin', 'password_hash' => app(PasswordService::class)->hash(self::ADMIN_PASSWORD)]);
        $admin = $this->login($email);
        $me = collect($admin->get('/platform/operators')->body)->firstWhere('email', $email);
        $this->assertTrue($me['isMe']);

        // Alta: valida email, clave y repetidos.
        $bad = $admin->post('/platform/operators', ['name' => 'Sofi', 'email' => 'sofi@', 'password' => 'corta'])->body;
        $this->assertSame(['email', 'password'], array_column($bad['details'] ?? [], 'path'), json_encode($bad));
        $new = $admin->post('/platform/operators', ['name' => 'Sofía', 'email' => strtoupper($sofi = self::uniqueEmail('sofi')), 'password' => 'Clave-Inicial-2026']);
        $this->assertSame(201, $new->status, json_encode($new->body));
        $this->assertSame([$sofi, 'active', null, false], [$new->body['email'], $new->body['status'], $new->body['lastSeenAt'], $new->body['isMe']]);
        $this->assertSame('EMAIL_IN_USE', $admin->post('/platform/operators', ['name' => 'Otra', 'email' => $sofi, 'password' => 'Clave-Inicial-2026'])->body['code']);
        $sofia = $this->login($sofi, 'Clave-Inicial-2026');

        // Clave nueva: la sesión abierta de Sofía se cierra y entra con la nueva.
        $this->assertSame(200, $admin->post("/platform/operators/{$new->body['id']}/password", ['password' => 'Clave-Nueva-2026-x'])->status);
        $this->assertSame(401, $sofia->get('/platform/auth/me')->status);
        $sofia = $this->login($sofi, 'Clave-Nueva-2026-x');

        // Desactivar: no a uno mismo; al otro se le cierran las sesiones y no puede entrar.
        $this->assertSame('SELF_DEACTIVATE', $admin->post("/platform/operators/{$me['id']}/status", ['status' => 'inactive'])->body['code']);
        $this->assertSame('inactive', $admin->post("/platform/operators/{$new->body['id']}/status", ['status' => 'inactive'])->body['status']);
        $this->assertSame(401, $sofia->get('/platform/auth/me')->status);
        $this->assertSame(401, $this->client()->post('/platform/auth/login', ['email' => $sofi, 'password' => 'Clave-Nueva-2026-x'])->status);
        $this->assertSame('active', $admin->post("/platform/operators/{$new->body['id']}/status", ['status' => 'active'])->body['status']);
        $this->login($sofi, 'Clave-Nueva-2026-x');

        // Cambiar la propia clave no cierra la sesión actual.
        $this->assertSame(200, $admin->post("/platform/operators/{$me['id']}/password", ['password' => 'Mi-Clave-Nueva-2026'])->status);
        $this->assertSame(200, $admin->get('/platform/auth/me')->status);
    }

    public function test_un_comercio_no_administra_operadores(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $this->assertSame(401, $owner->get('/platform/operators')->status);
        $this->assertSame(401, $owner->post('/platform/operators', ['name' => 'X', 'email' => 'x@example.com', 'password' => 'Clave-Inicial-2026'])->status);
    }
}
