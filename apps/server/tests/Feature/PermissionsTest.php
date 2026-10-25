<?php

namespace Tests\Feature;

use App\Support\Catalog;
use Tests\Support\Routes;
use Tests\TestCase;

/** Permisos verificados en el servidor para cada ruta de routes/api.php. */
class PermissionsTest extends TestCase
{
    private const ZERO_UUID = '00000000-0000-7000-8000-000000000000';

    /** Rutas de comercio sin permiso específico: datos propios, del comercio y sus sucursales. */
    private const OPEN_TO_MEMBERS = ['GET /tenant', 'GET /branches'];

    public function test_toda_ruta_no_publica_exige_sesion(): void
    {
        $anon = $this->client();
        $anon->cookies['gc_csrf'] = str_repeat('x', 43); // para llegar a la verificación de sesión
        $routes = array_filter(Routes::api(), fn ($r) => ! $r['public']);
        $this->assertGreaterThan(15, count($routes));
        foreach ($routes as $r) {
            $res = $anon->request($r['method'], Routes::fill($r['path'], self::ZERO_UUID), $r['method'] === 'GET' ? null : []);
            $this->assertSame(401, $res->status, "{$r['method']} {$r['path']}");
            $this->assertSame('UNAUTHENTICATED', $res->body['code']);
        }
    }

    public function test_las_rutas_publicas_son_exactamente_las_previstas(): void
    {
        $public = array_map(fn ($r) => "{$r['method']} {$r['path']}", array_filter(Routes::api(), fn ($r) => $r['public']));
        sort($public);
        $this->assertSame([
            'GET /business-types', 'GET /health', 'POST /auth/forgot-password', 'POST /auth/login', 'POST /auth/register',
            'POST /auth/reset-password', 'POST /platform/auth/login',
        ], array_values($public));
    }

    public function test_toda_ruta_de_comercio_declara_permiso_salvo_las_abiertas_a_miembros(): void
    {
        $valid = Catalog::permissionCodes();
        foreach (Routes::api() as $r) {
            if ($r['public'] || $r['platform'] || str_starts_with($r['path'], '/auth/')) {
                continue;
            }
            $key = "{$r['method']} {$r['path']}";
            if (in_array($key, self::OPEN_TO_MEMBERS, true)) {
                $this->assertSame([], $r['permissions'], $key);

                continue;
            }
            $this->assertNotEmpty($r['permissions'], "{$key} no declara perm:...");
            foreach ($r['permissions'] as $p) {
                $this->assertContains($p, $valid, "{$key} usa un permiso inexistente: {$p}");
            }
        }
    }

    public function test_toda_ruta_con_permiso_responde_403_a_un_rol_sin_permisos(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $role = $owner->post('/roles', ['name' => 'Sin permisos', 'permissions' => []]);
        $this->assertSame(201, $role->status);
        ['client' => $client] = $this->addEmployee($owner, $role->body['id'], $me['branchIds']);

        $routes = array_filter(Routes::api(), fn ($r) => ! $r['public'] && ! $r['platform'] && $r['permissions'] !== []);
        $this->assertGreaterThan(8, count($routes));
        foreach ($routes as $r) {
            $res = $client->request($r['method'], Routes::fill($r['path'], self::ZERO_UUID), $r['method'] === 'GET' ? null : []);
            $this->assertSame(403, $res->status, "{$r['method']} {$r['path']}");
            $this->assertSame('FORBIDDEN', $res->body['code']);
        }
        $this->assertSame(200, $client->get('/auth/me')->status);
        $this->assertSame(200, $client->get('/tenant')->status);
    }

    public function test_una_sesion_de_comercio_no_sirve_para_el_panel_de_plataforma(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $this->assertSame(401, $owner->get('/platform/tenants')->status);
    }

    public function test_el_cajero_opera_solo_lo_que_su_rol_permite(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner, 'cashier');
        ['client' => $client] = $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $this->assertSame(403, $client->get('/employees')->status);
        $this->assertSame(403, $client->post('/branches', ['name' => 'Otra'])->status);
        $this->assertSame(403, $client->put('/tenant', [])->status);
        $permissions = $client->get('/auth/me')->body['permissions'];
        $this->assertContains('sales.create', $permissions);
        $this->assertNotContains('sales.void', $permissions);
    }
}
