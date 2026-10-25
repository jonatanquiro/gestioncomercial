<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Role;
use App\Tenancy\BelongsToTenant;
use App\Tenancy\MissingTenantContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use Symfony\Component\Finder\Finder;
use Tests\Support\Routes;
use Tests\TestCase;

/**
 * Aislamiento entre comercios (sección 0 del diseño: reemplazo de RLS en MySQL).
 * Se prueba por API, en el modelo y en la base, y con verificaciones estáticas del código.
 */
class IsolationTest extends TestCase
{
    /** Tablas con tenant_id que no son datos de un comercio: la sesión guarda el comercio elegido y la auditoría incluye eventos sin comercio. */
    private const TENANT_COLUMN_EXCEPTIONS = ['user_sessions', 'audit_log'];

    /** Únicos archivos que pueden consultar sin el filtro automático por comercio. */
    private const BYPASS_ALLOWED = [
        'app/Services/AuthService.php',          // membresías del propio usuario, siempre por user_id
        'app/Http/Controllers/PlatformController.php', // panel de plataforma
        'app/Tenancy/TenantContext.php',
        'app/Tenancy/BelongsToTenant.php',
        'app/Services/CatalogSync.php',          // catálogos globales (permisos, rubros)
        'app/Http/Controllers/HealthController.php',
    ];

    private array $a;

    private array $b;

    private array $bIds;

    protected function setUp(): void
    {
        parent::setUp();
        $this->a = $this->registerTenant(['tradeName' => 'Comercio A']);
        $this->b = $this->registerTenant(['tradeName' => 'Comercio B']);
        $cashier = $this->roleByTemplate($this->b['client'], 'cashier');
        $emp = $this->addEmployee($this->b['client'], $cashier['id'], $this->b['me']['branchIds']);
        $product = $this->createProduct($this->b['client'], ['initialStock' => '10']);
        $warehouse = $this->defaultWarehouse($this->b['client']);
        $count = $this->b['client']->post('/stock-counts', ['warehouseId' => $warehouse, 'scope' => 'partial', 'notes' => null]);
        $register = $this->b['client']->get('/registers')->body[0];
        $shift = $this->b['client']->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '100']);
        $cash = collect($this->b['client']->get('/payment-methods')->body)->firstWhere('kind', 'cash');
        $sale = $this->b['client']->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $product['variantId'], 'quantity' => '1']],
            'payments' => [['paymentMethodId' => $cash['id'], 'amount' => '1000']], 'expectedTotal' => '1000.00',
        ]);
        $this->bIds = [
            'branch' => $this->b['me']['branchIds'][0], 'role' => $cashier['id'], 'membership' => $emp['membershipId'],
            'category' => $this->b['client']->get('/categories')->body[0]['id'], 'product' => $product['id'], 'variant' => $product['variantId'],
            'warehouse' => $warehouse, 'count' => $count->body['id'], 'barcode' => $product['barcodes'][0]['code'],
            'register' => $register['id'], 'shift' => $shift->body['id'], 'paymentMethod' => $cash['id'], 'sale' => $sale->body['id'],
            'saleLine' => $sale->body['lines'][0]['id'],
        ];
    }

    public function test_a_no_ve_datos_de_b_en_los_listados(): void
    {
        $a = $this->a['client'];
        $this->assertNotContains($this->bIds['branch'], array_column($a->get('/branches')->body, 'id'));
        $this->assertNotContains($this->bIds['role'], array_column($a->get('/roles')->body, 'id'));
        $this->assertNotContains($this->bIds['membership'], array_column($a->get('/employees')->body, 'membershipId'));
        $this->assertNotContains($this->b['tenantId'], array_column($a->get('/audit?pageSize=100')->body['items'], 'entityId'));
        $this->assertNotContains($this->bIds['category'], array_column($a->get('/categories')->body, 'id'));
        $this->assertNotContains($this->bIds['product'], array_column($a->get('/products?status=all&pageSize=100')->body['items'], 'id'));
        $this->assertNotContains($this->bIds['warehouse'], array_column($a->get('/warehouses')->body, 'id'));
        $this->assertNotContains($this->bIds['product'], array_column($a->get('/stock?pageSize=100')->body['items'], 'productId'));
        $this->assertNotContains($this->bIds['variant'], array_column($a->get('/stock/movements?pageSize=100')->body['items'], 'variantId'));
        $this->assertNotContains($this->bIds['count'], array_column($a->get('/stock-counts')->body, 'id'));
        $this->assertNotContains($this->bIds['register'], array_column($a->get('/registers')->body, 'id'));
        $this->assertNotContains($this->bIds['paymentMethod'], array_column($a->get('/payment-methods')->body, 'id'));
        $this->assertNotContains($this->bIds['shift'], array_column($a->get('/shifts')->body['items'], 'id'));
        $this->assertNotContains($this->bIds['sale'], array_column($a->get('/sales')->body['items'], 'id'));
        // Una venta de A no puede usar la caja ni los artículos de B.
        $cashA = collect($a->get('/payment-methods')->body)->firstWhere('kind', 'cash');
        $foreign = $a->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $this->bIds['register'], 'lines' => [['variantId' => $this->bIds['variant'], 'quantity' => '1']],
            'payments' => [['paymentMethodId' => $cashA['id'], 'amount' => '1000']], 'expectedTotal' => '1000.00',
        ]);
        $this->assertSame(404, $foreign->status);
        $this->assertSame(404, $a->get('/products/lookup?code='.$this->bIds['barcode'])->status);
        $this->assertSame(404, $a->get('/stock?warehouseId='.$this->bIds['warehouse'])->status);
    }

    public function test_cada_ruta_con_identificador_responde_404_ante_un_id_de_otro_comercio(): void
    {
        $bodies = [
            '/branches/{id}' => ['name' => 'Hackeada', 'address' => null, 'status' => 'active'],
            '/roles/{id}' => ['name' => 'Hackeado', 'permissions' => []],
            '/employees/{membershipId}' => ['roleId' => $this->bIds['role'], 'branchIds' => [$this->bIds['branch']], 'status' => 'inactive'],
            '/categories/{id}' => ['name' => 'Hackeada', 'status' => 'inactive'],
            '/products/{id}' => self::productUpdate($this->b['client']->get('/products/'.$this->bIds['product'])->body, ['name' => 'Hackeado']),
            '/products/{id}/status' => ['status' => 'inactive'],
            '/stock-counts/{id}/lines' => ['lines' => [['variantId' => $this->bIds['variant'], 'counted' => '0']]],
            '/stock-counts/{id}/close' => [],
            '/stock-counts/{id}/cancel' => [],
            '/registers/{id}' => ['name' => 'Hackeada', 'status' => 'inactive'],
            '/payment-methods/{id}' => ['name' => 'Hackeado', 'kind' => 'cash', 'requiresReference' => false, 'active' => false, 'sortOrder' => 1],
            '/shifts/{id}/movements' => ['type' => 'withdrawal', 'amount' => '50', 'reason' => 'Hackeo'],
            '/shifts/{id}/counts' => ['counted' => '0'],
            '/shifts/{id}/close' => ['counted' => '0'],
            '/sales/{id}/void' => ['reason' => 'Hackeo'],
            '/sales/{id}/returns' => [
                'clientUuid' => self::uuid(), 'registerId' => $this->a['client']->get('/registers')->body[0]['id'], 'reason' => 'Hackeo',
                'paymentMethodId' => $this->bIds['paymentMethod'], 'lines' => [['saleLineId' => $this->bIds['saleLine'], 'quantity' => '1', 'restock' => true]],
            ],
        ];
        $idFor = fn (string $path) => match (true) {
            str_starts_with($path, '/branches') => $this->bIds['branch'],
            str_starts_with($path, '/roles') => $this->bIds['role'],
            str_starts_with($path, '/employees') => $this->bIds['membership'],
            str_starts_with($path, '/categories') => $this->bIds['category'],
            str_starts_with($path, '/products') => $this->bIds['product'],
            str_starts_with($path, '/stock-counts') => $this->bIds['count'],
            str_starts_with($path, '/registers') => $this->bIds['register'],
            str_starts_with($path, '/payment-methods') => $this->bIds['paymentMethod'],
            str_starts_with($path, '/shifts') => $this->bIds['shift'],
            str_starts_with($path, '/sales') => $this->bIds['sale'],
            default => null,
        };
        $checked = [];
        $unchecked = [];
        foreach (Routes::api() as $r) {
            if ($r['public'] || $r['platform'] || ! str_contains($r['path'], '{')) {
                continue;
            }
            $id = $idFor($r['path']);
            if ($id === null) {
                $unchecked[] = "{$r['method']} {$r['path']}";

                continue;
            }
            $body = in_array($r['method'], ['GET', 'DELETE'], true) ? null : $bodies[$r['path']];
            $res = $this->a['client']->request($r['method'], Routes::fill($r['path'], $id), $body);
            $this->assertSame(404, $res->status, "{$r['method']} {$r['path']}: ".json_encode($res->body));
            $checked[] = "{$r['method']} {$r['path']}";
        }
        foreach ([
            'PUT /branches/{id}', 'PUT /roles/{id}', 'DELETE /roles/{id}', 'PUT /employees/{membershipId}', 'PUT /categories/{id}',
            'GET /products/{id}', 'GET /products/{id}/history', 'PUT /products/{id}', 'POST /products/{id}/status',
            'GET /stock-counts/{id}', 'PUT /stock-counts/{id}/lines', 'POST /stock-counts/{id}/close', 'POST /stock-counts/{id}/cancel',
            'PUT /registers/{id}', 'PUT /payment-methods/{id}', 'GET /shifts/{id}', 'POST /shifts/{id}/movements', 'POST /shifts/{id}/counts',
            'POST /shifts/{id}/close', 'GET /sales/{id}', 'POST /sales/{id}/void', 'POST /sales/{id}/returns',
        ] as $expected) {
            $this->assertContains($expected, $checked);
        }
        // Una ruta nueva con identificador tiene que sumarse acá (las sesiones se prueban abajo).
        $this->assertSame(['DELETE /auth/sessions/{id}'], $unchecked);

        $branchesB = collect($this->b['client']->get('/branches')->body);
        $this->assertSame('Casa central', $branchesB->firstWhere('id', $this->bIds['branch'])['name']);
        $productB = $this->b['client']->get('/products/'.$this->bIds['product'])->body;
        $this->assertSame('active', $productB['status']);
        $this->assertSame('9.000', $productB['stock']);
        $this->assertSame('open', $this->b['client']->get('/shifts/'.$this->bIds['shift'])->body['status']);
        $this->assertSame('confirmed', $this->b['client']->get('/sales/'.$this->bIds['sale'])->body['status']);
        $this->assertSame('open', $this->b['client']->get('/stock-counts/'.$this->bIds['count'])->body['status']);
    }

    public function test_no_permite_usar_productos_depositos_ni_categorias_de_otro_comercio(): void
    {
        $a = $this->a['client'];
        $warehouseA = $this->defaultWarehouse($a);
        $this->assertSame(404, $a->post('/products', self::productInput(['categoryId' => $this->bIds['category']]))->status);
        $adjust = fn (string $warehouse, string $variant) => $a->post('/stock/adjustments', [
            'clientUuid' => self::uuid(), 'warehouseId' => $warehouse, 'reason' => 'Cruzado', 'lines' => [['variantId' => $variant, 'mode' => 'delta', 'quantity' => '-5']],
        ]);
        $productA = $this->createProduct($a);
        $this->assertSame(404, $adjust($warehouseA, $this->bIds['variant'])->status);
        $this->assertSame(404, $adjust($this->bIds['warehouse'], $productA['variantId'])->status);
        $this->assertSame(404, $a->post('/stock/waste', [
            'clientUuid' => self::uuid(), 'warehouseId' => $warehouseA, 'reason' => 'Cruzado', 'type' => 'waste', 'lines' => [['variantId' => $this->bIds['variant'], 'quantity' => '1']],
        ])->status);
        $this->assertSame(404, $a->post('/stock-counts', ['warehouseId' => $this->bIds['warehouse'], 'scope' => 'partial', 'notes' => null])->status);
        $count = $a->post('/stock-counts', ['warehouseId' => $warehouseA, 'scope' => 'partial', 'notes' => null])->body;
        $this->assertSame(404, $a->put("/stock-counts/{$count['id']}/lines", ['lines' => [['variantId' => $this->bIds['variant'], 'counted' => '0']]])->status);
        $preview = $a->post('/prices/bulk/preview', ['scope' => ['categoryId' => null, 'brandId' => null, 'productIds' => [$this->bIds['product']]], 'rule' => ['kind' => 'percent', 'value' => '50'], 'roundingStep' => 0]);
        $this->assertSame(200, $preview->status);
        $this->assertSame([], $preview->body['rows']);
        $this->assertSame('9.000', $this->b['client']->get('/products/'.$this->bIds['product'])->body['stock']);
    }

    public function test_el_mismo_codigo_de_barras_puede_existir_en_dos_comercios(): void
    {
        $this->createProduct($this->a['client'], ['barcodes' => [['code' => $this->bIds['barcode'], 'quantityFactor' => '1']]]);
        $this->assertSame(200, $this->a['client']->get('/products/lookup?code='.$this->bIds['barcode'])->status);
    }

    public function test_no_permite_referenciar_recursos_de_otro_comercio_dentro_de_un_cuerpo(): void
    {
        $aCashier = $this->roleByTemplate($this->a['client'], 'cashier');
        $res = $this->a['client']->post('/employees', [
            'name' => 'Cruzado', 'email' => self::uniqueEmail(), 'password' => 'clave-segura-cruzada-1',
            'roleId' => $aCashier['id'], 'branchIds' => [$this->bIds['branch']],
        ]);
        $this->assertSame(404, $res->status);
        $res2 = $this->a['client']->post('/employees', [
            'name' => 'Cruzado', 'email' => self::uniqueEmail(), 'password' => 'clave-segura-cruzada-1',
            'roleId' => $this->bIds['role'], 'branchIds' => $this->a['me']['branchIds'],
        ]);
        $this->assertSame(404, $res2->status);
    }

    public function test_no_permite_cerrar_sesiones_de_otro_usuario(): void
    {
        $sessionsB = $this->b['client']->get('/auth/sessions')->body;
        $this->assertSame(404, $this->a['client']->delete('/auth/sessions/'.$sessionsB[0]['id'])->status);
        $this->assertSame(200, $this->b['client']->get('/auth/me')->status);
    }

    public function test_no_permite_seleccionar_un_comercio_del_que_no_es_miembro(): void
    {
        $this->assertSame(404, $this->a['client']->post('/auth/switch-tenant', ['tenantId' => $this->b['tenantId']])->status);
    }

    public function test_con_el_contexto_de_a_el_modelo_no_devuelve_filas_de_b(): void
    {
        $rows = app(TenantContext::class)->run($this->a['tenantId'], fn () => Branch::all());
        $this->assertNotEmpty($rows);
        $this->assertTrue($rows->every(fn ($r) => $r->tenant_id === $this->a['tenantId']));
        $found = app(TenantContext::class)->run($this->a['tenantId'], fn () => Branch::find($this->bIds['branch']));
        $this->assertNull($found);
    }

    public function test_sin_contexto_de_comercio_la_consulta_falla_en_lugar_de_devolver_todo(): void
    {
        $this->app->forgetScopedInstances(); // como al empezar un request nuevo
        $this->expectException(MissingTenantContext::class);
        Branch::count();
    }

    public function test_rechaza_crear_filas_con_el_tenant_id_de_otro_comercio(): void
    {
        $this->expectException(LogicException::class);
        app(TenantContext::class)->run($this->a['tenantId'], fn () => Role::create(['tenant_id' => $this->b['tenantId'], 'name' => 'Infiltrado']));
    }

    public function test_no_permite_mover_una_fila_a_otro_comercio(): void
    {
        $this->expectException(LogicException::class);
        app(TenantContext::class)->run($this->a['tenantId'], function () {
            $role = Role::firstOrFail();
            $role->tenant_id = $this->b['tenantId'];
            $role->save();
        });
    }

    public function test_la_fk_compuesta_impide_vincular_un_permiso_a_un_rol_de_otro_comercio(): void
    {
        try {
            DB::table('role_permissions')->insert(['tenant_id' => $this->a['tenantId'], 'role_id' => $this->bIds['role'], 'permission_code' => 'sales.void']);
            $this->fail('La base aceptó un permiso apuntando a un rol de otro comercio');
        } catch (QueryException $e) {
            $this->assertSame(1452, $e->errorInfo[1]);
        }
    }

    public function test_toda_tabla_con_tenant_id_tiene_modelo_con_filtro_y_clave_compuesta(): void
    {
        $tables = collect(DB::select(
            "SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'"
        ))->pluck('t')->diff(self::TENANT_COLUMN_EXCEPTIONS)->values();
        $this->assertGreaterThan(5, $tables->count());

        $scoped = [];
        foreach ((new Finder)->files()->in(app_path('Models'))->name('*.php') as $file) {
            $class = 'App\\Models\\'.$file->getBasename('.php');
            if (class_exists($class) && ! (new \ReflectionClass($class))->isAbstract()) {
                $model = new $class;
                if (in_array(BelongsToTenant::class, class_uses_recursive($class), true)) {
                    $scoped[] = $model->getTable();
                }
            }
        }
        $this->assertSame([], $tables->diff($scoped)->values()->all(), 'Tablas con tenant_id sin modelo que use BelongsToTenant');

        // Las tablas con id propio tienen UNIQUE (tenant_id, id) para que las FKs compuestas puedan apuntarles.
        foreach ($tables as $table) {
            $hasId = DB::selectOne("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'id'", [$table])->n;
            if (! $hasId) {
                continue;
            }
            $unique = DB::select('SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 GROUP BY INDEX_NAME', [$table]);
            $this->assertContains('tenant_id,id', array_column($unique, 'cols'), "{$table} no tiene UNIQUE (tenant_id, id)");
        }
    }

    public function test_solo_los_archivos_permitidos_saltean_el_filtro_por_comercio(): void
    {
        $tenantModels = [];
        foreach ((new Finder)->files()->in(app_path('Models'))->name('*.php') as $file) {
            $class = 'App\\Models\\'.$file->getBasename('.php');
            if (in_array(BelongsToTenant::class, class_uses_recursive($class), true)) {
                $tenantModels[] = $file->getBasename('.php');
            }
        }
        $models = implode('|', $tenantModels);
        $pattern = '/withoutGlobalScopes?\(|withoutTenant\(|DB::(table|select|selectOne|statement|unprepared|insert|update|delete|raw)\(|\b('.$models.')::(insert|insertOrIgnore|upsert)\(/';

        $offenders = [];
        foreach ((new Finder)->files()->in(app_path())->name('*.php') as $file) {
            $relative = 'app/'.str_replace('\\', '/', $file->getRelativePathname());
            if (in_array($relative, self::BYPASS_ALLOWED, true)) {
                continue;
            }
            foreach (explode("\n", $file->getContents()) as $n => $line) {
                if (preg_match($pattern, $line) && ! Str::startsWith(trim($line), ['*', '//', '/*'])) {
                    $offenders[] = "{$relative}:".($n + 1).': '.trim($line);
                }
            }
        }
        $this->assertSame([], $offenders);
    }
}
