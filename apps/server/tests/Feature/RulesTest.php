<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\PlanLimit;
use App\Models\Subscription;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\LiveServer;
use Tests\TestCase;

class RulesTest extends TestCase
{
    public function test_el_plan_inicial_permite_1_sucursal_y_3_usuarios(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $branch = $owner->post('/branches', ['name' => 'Sucursal 2']);
        $this->assertSame(402, $branch->status);
        $this->assertSame('PLAN_LIMIT_REACHED', $branch->body['code']);
        $this->assertSame(['limit' => 'max_branches', 'value' => 1], $branch->body['details']);

        $cashier = $this->roleByTemplate($owner, 'cashier');
        $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $fourth = $owner->post('/employees', [
            'name' => 'Cuarto', 'email' => self::uniqueEmail(), 'password' => self::PASSWORD,
            'roleId' => $cashier['id'], 'branchIds' => $me['branchIds'],
        ]);
        $this->assertSame(402, $fourth->status);
        $this->assertSame('max_users', $fourth->body['details']['limit']);
    }

    public function test_altas_simultaneas_no_superan_el_limite(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        // Plan de prueba con 3 sucursales asignado directamente.
        $plan = Plan::create(['code' => 'prueba-3-'.random_int(0, 999999999), 'name' => 'Prueba', 'price' => '0']);
        PlanLimit::insert([['plan_id' => $plan->id, 'key' => 'max_branches', 'value' => 3]]);
        app(TenantContext::class)->run($tenantId, fn () => Subscription::query()->update(['plan_id' => $plan->id]));

        $server = new LiveServer(workers: 8);
        try {
            $codes = $server->parallel(array_map(
                fn ($i) => ['method' => 'POST', 'path' => '/branches', 'body' => ['name' => "Paralela {$i}"]],
                range(1, 12),
            ), $owner->cookies);
        } finally {
            $server->stop();
        }
        sort($codes);
        $this->assertSame([201, 201, ...array_fill(0, 10, 402)], $codes);
        $this->assertCount(3, $owner->get('/branches')->body);
    }

    public function test_el_alta_espera_el_bloqueo_del_comercio(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant();
        // Otra conexión toma el bloqueo del comercio, como lo haría un alta en curso.
        config(['database.connections.mysql_lock' => config('database.connections.mysql')]);
        $other = DB::connection('mysql_lock');
        $other->beginTransaction();
        try {
            $other->select('SELECT id FROM tenants WHERE id = ? FOR UPDATE', [$tenantId]);
            DB::statement('SET SESSION innodb_lock_wait_timeout = 1');
            $res = $owner->post('/branches', ['name' => 'Bloqueada']);
            $this->assertSame(503, $res->status);
            $this->assertSame('BUSY', $res->body['code']);
        } finally {
            $other->rollBack();
            DB::statement('SET SESSION innodb_lock_wait_timeout = 50');
        }
    }

    public function test_el_rol_propietario_no_se_puede_modificar_ni_eliminar(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $ownerRole = collect($this->rolesOf($owner))->firstWhere('isSystem', true);
        $this->assertSame('SYSTEM_ROLE', $owner->put("/roles/{$ownerRole['id']}", ['name' => 'Dueño', 'permissions' => []])->body['code']);
        $this->assertSame('SYSTEM_ROLE', $owner->delete("/roles/{$ownerRole['id']}")->body['code']);
    }

    public function test_nadie_otorga_permisos_que_no_tiene_ni_modifica_a_alguien_con_mas_permisos(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $roles = collect($this->rolesOf($owner));
        $custom = $owner->post('/roles', ['name' => 'Gestor de personal', 'permissions' => ['users.manage', 'roles.manage', 'products.read']]);
        ['client' => $manager] = $this->addEmployee($owner, $custom->body['id'], $me['branchIds']);

        $escalate = $manager->post('/roles', ['name' => 'Escalado', 'permissions' => ['sales.void']]);
        $this->assertSame(400, $escalate->status);
        $this->assertSame('CANNOT_GRANT', $escalate->body['code']);

        $admin = $roles->firstWhere('templateCode', 'admin');
        $assign = $manager->post('/employees', [
            'name' => 'Admin falso', 'email' => self::uniqueEmail(), 'password' => self::PASSWORD,
            'roleId' => $admin['id'], 'branchIds' => $me['branchIds'],
        ]);
        $this->assertSame('CANNOT_GRANT', $assign->body['code']);

        $ownerMembership = collect($manager->get('/employees')->body)->firstWhere('roleId', $roles->firstWhere('isSystem', true)['id']);
        $demote = $manager->put("/employees/{$ownerMembership['membershipId']}", [
            'roleId' => $custom->body['id'], 'branchIds' => $me['branchIds'], 'status' => 'inactive',
        ]);
        $this->assertSame('CANNOT_GRANT', $demote->body['code']);
    }

    public function test_debe_quedar_un_propietario_activo_y_nadie_se_desactiva_a_si_mismo(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $self = $owner->get('/employees')->body[0];
        $res = $owner->put("/employees/{$self['membershipId']}", ['roleId' => $self['roleId'], 'branchIds' => $me['branchIds'], 'status' => 'inactive']);
        $this->assertSame('SELF_DEACTIVATION', $res->body['code']);

        $ownerRole = collect($this->rolesOf($owner))->firstWhere('isSystem', true);
        ['client' => $second, 'membershipId' => $secondId] = $this->addEmployee($owner, $ownerRole['id'], $me['branchIds']);
        // El segundo propietario no puede dejar al primero sin rol si sería el último... pero con dos, se puede desactivar a uno.
        $this->assertSame(200, $owner->put("/employees/{$secondId}", ['roleId' => $ownerRole['id'], 'branchIds' => $me['branchIds'], 'status' => 'inactive'])->status);
        $this->assertSame(403, $second->get('/tenant')->status);
    }

    public function test_un_rol_con_empleados_no_se_puede_eliminar(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner, 'cashier');
        $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $this->assertSame('ROLE_IN_USE', $owner->delete("/roles/{$cashier['id']}")->body['code']);
        $unused = $this->roleByTemplate($owner, 'accountant');
        $this->assertSame(200, $owner->delete("/roles/{$unused['id']}")->status);
    }

    public function test_un_empleado_desactivado_pierde_el_acceso_al_comercio(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner, 'cashier');
        $emp = $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $this->assertSame(200, $emp['client']->get('/tenant')->status);
        $owner->put("/employees/{$emp['membershipId']}", ['roleId' => $cashier['id'], 'branchIds' => $me['branchIds'], 'status' => 'inactive']);
        $res = $emp['client']->get('/tenant');
        $this->assertSame(403, $res->status);
        $this->assertSame('NO_ACTIVE_TENANT', $res->body['code']);
    }

    public function test_una_persona_puede_trabajar_en_dos_comercios_y_elegir_cual_usar(): void
    {
        $a = $this->registerTenant(['tradeName' => 'Kiosco Uno']);
        $b = $this->registerTenant(['tradeName' => 'Kiosco Dos']);
        $cashierB = $this->roleByTemplate($b['client'], 'cashier');
        $add = $b['client']->post('/employees', [
            'name' => 'Ignorado', 'email' => $a['input']['email'], 'password' => 'otra-clave-que-no-se-usa',
            'roleId' => $cashierB['id'], 'branchIds' => $b['me']['branchIds'],
        ]);
        $this->assertSame(201, $add->status);
        $this->assertTrue($add->body['existingUser']);

        $names = array_column($a['client']->get('/auth/me')->body['memberships'], 'tenantName');
        sort($names);
        $this->assertSame(['Kiosco Dos', 'Kiosco Uno'], $names);
        $this->assertSame(200, $a['client']->post('/auth/switch-tenant', ['tenantId' => $b['tenantId']])->status);
        $after = $a['client']->get('/auth/me')->body;
        $this->assertSame('Kiosco Dos', $after['tenant']['tradeName']);
        $this->assertSame('Cajero', $after['role']['name']);
    }

    public function test_guarda_la_configuracion_del_comercio_y_la_audita_con_antes_y_despues(): void
    {
        ['client' => $owner, 'input' => $input] = $this->registerTenant();
        $tenant = $owner->get('/tenant')->body;
        $cuit = self::randomCuit();
        $res = $owner->put('/tenant', [
            'tradeName' => 'Nombre Nuevo', 'legalName' => 'Razón Social SRL',
            'cuit' => substr($cuit, 0, 2).'-'.substr($cuit, 2, 8).'-'.substr($cuit, 10),
            'taxCondition' => 'responsable_inscripto', 'address' => 'Av. Siempre Viva 742', 'phone' => '+54 11 5555-5555',
            'email' => 'Contacto@Test.local',
            'settings' => ['allowNegativeStock' => ! $tenant['settings']['allowNegativeStock'], 'priceRoundingStep' => 50],
        ]);
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame($cuit, $res->body['cuit']);
        $this->assertSame('contacto@test.local', $res->body['email']);
        $this->assertSame(50, $res->body['settings']['priceRoundingStep']);

        $bad = $owner->put('/tenant', [...$res->body, 'settings' => ['allowNegativeStock' => 'si', 'priceRoundingStep' => 7]]);
        $this->assertSame(400, $bad->status);
        $this->assertEqualsCanonicalizing(['settings.allowNegativeStock', 'settings.priceRoundingStep'], array_column($bad->body['details'], 'path'));

        $entry = collect($owner->get('/audit?entityType=tenant')->body['items'])->firstWhere('action', 'tenant.updated');
        $this->assertSame($tenant['tradeName'], $entry['before']['tradeName']);
        $this->assertSame('Nombre Nuevo', $entry['after']['tradeName']);
        $this->assertSame($input['ownerName'], $entry['actorName']);
    }

    public function test_la_auditoria_no_se_puede_modificar_ni_borrar_ni_desde_la_base(): void
    {
        $this->registerTenant();
        foreach (["UPDATE audit_log SET action = 'x'", 'DELETE FROM audit_log'] as $sql) {
            try {
                DB::statement($sql);
                $this->fail("La base aceptó: {$sql}");
            } catch (QueryException $e) {
                $this->assertStringContainsString('solo agregado', $e->getMessage());
            }
        }
    }

    public function test_no_permite_desactivar_la_ultima_sucursal(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $res = $owner->put("/branches/{$me['branchIds'][0]}", ['name' => 'Casa central', 'address' => null, 'status' => 'inactive']);
        $this->assertSame('LAST_BRANCH', $res->body['code']);
    }

    public function test_devuelve_errores_con_formato_unico_y_request_id(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $res = $owner->post('/branches', ['name' => '']);
        $this->assertSame(400, $res->status);
        $this->assertSame('VALIDATION_ERROR', $res->body['code']);
        $this->assertSame([['path' => 'name', 'message' => 'Obligatorio']], $res->body['details']);
        $this->assertIsString($res->body['message']);
        $this->assertSame($res->header('x-request-id'), $res->body['requestId']);

        $missing = $this->client()->get('/no-existe');
        $this->assertSame(404, $missing->status);
        $this->assertSame('NOT_FOUND', $missing->body['code']);
    }

    public function test_nombres_repetidos_devuelven_un_mensaje_claro(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $first = $owner->post('/roles', ['name' => 'Turno noche', 'permissions' => []]);
        $this->assertSame(201, $first->status);
        $dup = $owner->post('/roles', ['name' => 'turno NOCHE', 'permissions' => []]);
        $this->assertSame(409, $dup->status);
        $this->assertSame('Ya existe un rol con ese nombre', $dup->body['message']);
    }
}
