<?php

namespace Tests\Feature;

use App\Http\Controllers\ProductsController;
use App\Support\Catalog;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Fase 3 · productos: alta, edición, búsqueda, desactivación, códigos y permisos sobre precios y costos. */
class ProductsTest extends TestCase
{
    public function test_el_comercio_nuevo_tiene_las_categorias_de_su_rubro(): void
    {
        ['client' => $kiosco] = $this->registerTenant(['businessTypeCode' => 'kiosco']);
        ['client' => $ferreteria] = $this->registerTenant(['businessTypeCode' => 'ferreteria']);
        $expected = fn (string $code) => collect(Catalog::businessTypes())->firstWhere('code', $code)['defaultCategories'];

        $names = fn ($client) => collect($client->get('/categories')->body)->pluck('name')->sort()->values()->all();
        $this->assertSame(collect($expected('kiosco'))->sort()->values()->all(), $names($kiosco));
        $this->assertSame(collect($expected('ferreteria'))->sort()->values()->all(), $names($ferreteria));
    }

    public function test_alta_busqueda_por_nombre_codigo_y_sku_y_desactivacion(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $category = $owner->get('/categories')->body[0];
        $brand = $owner->post('/brands', ['name' => 'Marca '.random_int(0, 99999)])->body;
        $p = $this->createProduct($owner, [
            'name' => 'Alfajor triple chocolate', 'categoryId' => $category['id'], 'brandId' => $brand['id'], 'sku' => 'ALF-3',
            'barcodes' => [['code' => '7790001112223', 'quantityFactor' => '1'], ['code' => '17790001112220', 'quantityFactor' => '12']],
            'initialStock' => '24',
        ]);
        // La guía de primeros pasos del inicio se apoya en este uso.
        $this->assertSame(['products' => 1, 'hasSales' => false], array_intersect_key($owner->get('/tenant')->body['usage'], ['products' => 1, 'hasSales' => 1]));
        $this->assertSame($category['name'], $p['categoryName']);
        $this->assertSame($brand['name'], $p['brandName']);
        $this->assertSame([], $p['optionNames']);
        $this->assertCount(1, $p['variants']);
        $this->assertNull($p['variants'][0]['label']);
        $this->assertSame('1000.00', $p['variants'][0]['price']);
        $this->assertSame('600.0000', $p['variants'][0]['cost']);
        $this->assertSame('24.000', $p['stock']);
        $this->assertCount(2, $p['variants'][0]['barcodes']);

        foreach (['triple choc', '7790001112223', 'ALF-3'] as $term) {
            $ids = array_column($owner->get('/products?q='.urlencode($term))->body['items'], 'id');
            $this->assertSame([$p['id']], $ids, "Buscando {$term}");
        }

        // El código del pack representa 12 unidades.
        $pack = $owner->get('/products/lookup?code=17790001112220')->body;
        $this->assertSame($p['id'], $pack['item']['productId']);
        $this->assertSame($p['variantId'], $pack['item']['variantId']);
        $this->assertSame('12.000', $pack['quantityFactor']);
        $this->assertSame('1.000', $owner->get('/products/lookup?code=ALF-3')->body['quantityFactor']);

        $res = $owner->post("/products/{$p['id']}/status", ['status' => 'inactive']);
        $this->assertSame('inactive', $res->body['status']);
        $this->assertSame([], $owner->get('/products?q=ALF-3')->body['items']);
        $this->assertCount(1, $owner->get('/products?q=ALF-3&status=inactive')->body['items']);
        $this->assertSame('active', $owner->post("/products/{$p['id']}/status", ['status' => 'active'])->body['status']);
    }

    public function test_rechaza_codigos_de_barras_y_sku_duplicados(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $p = $this->createProduct($owner, ['sku' => 'GAL-1']);
        $code = $p['variants'][0]['barcodes'][0]['code'];

        $dup = $owner->post('/products', self::productInput(['barcodes' => [['code' => $code, 'quantityFactor' => '1']]]));
        $this->assertSame(409, $dup->status);
        $this->assertSame('BARCODE_DUPLICATE', $dup->body['code']);
        $this->assertStringContainsString($p['name'], $dup->body['message']);

        $sku = $owner->post('/products', self::productInput(['sku' => 'GAL-1']));
        $this->assertSame(409, $sku->status);
        $this->assertSame('SKU_DUPLICATE', $sku->body['code']);

        $same = $owner->post('/products', self::productInput(['barcodes' => [['code' => '111', 'quantityFactor' => '1'], ['code' => '111', 'quantityFactor' => '6']]]));
        $this->assertSame(400, $same->status);
        $this->assertContains('variants.0.barcodes.1.code', array_column($same->body['details'], 'path'));

        // Editar el propio producto conservando su código no es un duplicado.
        $this->assertSame(200, $owner->put("/products/{$p['id']}", self::productUpdate($p, ['name' => 'Galletitas']))->status);
    }

    public function test_valida_importes_y_cantidades_como_texto_decimal(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $res = $owner->post('/products', self::productInput(['price' => 10.5, 'cost' => '1,5', 'minStock' => '2.5']));
        $this->assertSame(400, $res->status);
        $paths = array_column($res->body['details'], 'path');
        $this->assertContains('variants.0.price', $paths);
        $this->assertContains('variants.0.cost', $paths);

        $unit = $owner->post('/products', self::productInput(['minStock' => '2.5']));
        $this->assertSame(400, $unit->status);
        $this->assertSame('minStock', $unit->body['details'][0]['path']);

        $weight = $this->createProduct($owner, ['saleMode' => 'weight', 'minStock' => '2.5', 'initialStock' => '10.250', 'barcodes' => []]);
        $this->assertSame('10.250', $weight['stock']);
    }

    public function test_un_servicio_no_controla_stock(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $s = $this->createProduct($owner, ['kind' => 'service', 'name' => 'Carga de celular', 'trackStock' => true, 'initialStock' => '5', 'barcodes' => []]);
        $this->assertFalse($s['trackStock']);
        $this->assertNull($s['stock']);
        $res = $owner->post('/stock/adjustments', [
            'clientUuid' => self::uuid(), 'warehouseId' => $this->defaultWarehouse($owner), 'reason' => 'Prueba',
            'lines' => [['variantId' => $s['variantId'], 'mode' => 'delta', 'quantity' => '1']],
        ]);
        $this->assertSame(409, $res->status);
        $this->assertSame('STOCK_NOT_TRACKED', $res->body['code']);
    }

    public function test_edicion_con_historial_de_precios_y_control_de_version(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $p = $this->createProduct($owner);
        $updated = $owner->put("/products/{$p['id']}", self::productUpdate($p, ['price' => '1250.50', 'cost' => '700', 'name' => 'Nuevo nombre']));
        $this->assertSame(200, $updated->status, json_encode($updated->body));
        $this->assertSame('1250.50', $updated->body['variants'][0]['price']);
        $this->assertSame(2, $updated->body['version']);

        // Otro usuario editando con la versión vieja recibe un conflicto en lugar de pisar los cambios.
        $stale = $owner->put("/products/{$p['id']}", self::productUpdate($p, ['name' => 'Pisado']));
        $this->assertSame(409, $stale->status);
        $this->assertSame('VERSION_CONFLICT', $stale->body['code']);

        $history = $owner->get("/products/{$p['id']}/history")->body;
        $this->assertSame(['1250.50', '1000.00'], array_column($history['prices'], 'price'));
        $this->assertNull($history['prices'][0]['validTo']);
        $this->assertNotNull($history['prices'][1]['validTo']);
        $this->assertSame(['700.0000', '600.0000'], array_column($history['costs'], 'cost'));
        $this->assertSame('product.updated', $history['changes'][0]['action']);
        $this->assertSame(['name' => 'Nuevo nombre', 'price' => '1250.50', 'cost' => '700.0000'], $history['changes'][0]['after']);
        $this->assertSame('product.created', $history['changes'][1]['action']);
    }

    public function test_quien_no_ve_costos_no_los_recibe_ni_los_pisa(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $p = $this->createProduct($owner, ['cost' => '450']);
        $stocker = $this->roleByTemplate($owner, 'stocker'); // crea y edita productos, sin costos ni precios
        ['client' => $client] = $this->addEmployee($owner, $stocker['id'], $me['branchIds']);

        $seen = $client->get("/products/{$p['id']}")->body;
        $this->assertNull($seen['variants'][0]['cost']);
        $this->assertSame([], $client->get("/products/{$p['id']}/history")->body['costs']);

        $ok = $client->put("/products/{$p['id']}", self::productUpdate($seen, ['name' => 'Editado por repositor']));
        $this->assertSame(200, $ok->status, json_encode($ok->body));
        $this->assertSame('450.0000', $owner->get("/products/{$p['id']}")->body['variants'][0]['cost']);

        $price = $client->put("/products/{$p['id']}", self::productUpdate($ok->body, ['price' => '1']));
        $this->assertSame(403, $price->status);
        $this->assertSame('prices.update', $price->body['details']['permission']);

        $withCost = $client->post('/products', self::productInput(['cost' => '10']));
        $this->assertSame(403, $withCost->status);
        $this->assertSame(201, $client->post('/products', self::productInput(['cost' => null]))->status);
    }

    public function test_el_stock_inicial_necesita_permiso_de_ajuste(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $role = $owner->post('/roles', ['name' => 'Alta sin stock', 'permissions' => ['products.read', 'products.create']])->body;
        ['client' => $client] = $this->addEmployee($owner, $role['id'], $me['branchIds']);
        $res = $client->post('/products', self::productInput(['cost' => null, 'initialStock' => '5']));
        $this->assertSame(403, $res->status);
        $this->assertSame(201, $client->post('/products', self::productInput(['cost' => null, 'initialStock' => '0']))->status);
    }

    public function test_categorias_y_marcas_con_nombre_unico(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $c = $owner->post('/categories', ['name' => 'Panadería']);
        $this->assertSame(201, $c->status);
        $this->assertSame('NAME_TAKEN', $owner->post('/categories', ['name' => 'panadería'])->body['code']);
        $this->assertSame(200, $owner->put("/categories/{$c->body['id']}", ['name' => 'Panificados', 'status' => 'inactive'])->status);
        $this->assertSame('inactive', collect($owner->get('/categories')->body)->firstWhere('id', $c->body['id'])['status']);
        $this->assertSame(201, $owner->post('/brands', ['name' => 'Arcor'])->status);
        $this->assertSame(409, $owner->post('/brands', ['name' => 'ARCOR'])->status);
    }

    /** Talles y colores (ADR 0013): una variante por combinación, cada una con su precio, códigos y stock. */
    public function test_producto_con_talles_y_colores(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant(['businessTypeCode' => 'ropa']);
        $this->withPlan($tenantId, 'multisucursal');
        $variant = fn (array $options, array $extra = []) => [
            'id' => null, 'options' => $options, 'sku' => null, 'price' => '15000', 'cost' => null, 'barcodes' => [], 'initialStock' => null, ...$extra,
        ];
        $res = $owner->post('/products', self::productInput([
            'name' => 'Remera lisa', 'optionNames' => ['Talle', 'Color'],
            'variants' => [
                $variant(['S', 'Rojo'], ['initialStock' => '3']),
                $variant(['M', 'Rojo'], ['initialStock' => '5', 'barcodes' => [['code' => 'REM-M-R', 'quantityFactor' => '1']]]),
                $variant(['XL', 'Negro'], ['price' => '17000']),
            ],
        ]));
        $this->assertSame(201, $res->status, json_encode($res->body));
        $p = $res->body;
        $this->assertSame(['Talle', 'Color'], $p['optionNames']);
        $this->assertSame(['S / Rojo', 'M / Rojo', 'XL / Negro'], array_column($p['variants'], 'label'));
        $this->assertSame(['3.000', '5.000', '0.000'], array_column($p['variants'], 'stock'));
        $this->assertSame('8.000', $p['stock']);
        $this->assertSame('17000.00', $p['variants'][2]['price']);

        // Sin código de barras se encuentra por nombre y propiedades, palabra por palabra.
        $found = $owner->get('/products/items?q='.urlencode('remera m rojo'))->body['items'];
        $this->assertSame(['M / Rojo'], array_column($found, 'variantLabel'));
        $this->assertSame('5.000', $found[0]['stock']);
        $this->assertCount(3, $owner->get('/products/items?q=remera')->body['items']);
        $this->assertSame([$p['id']], array_column($owner->get('/products?q=negro')->body['items'], 'id'));
        $this->assertSame('M / Rojo', $owner->get('/products/lookup?code=REM-M-R')->body['item']['variantLabel']);

        // La venta congela «Producto · talle / color» y descuenta el stock de esa variante.
        $register = $owner->get('/registers')->body[0];
        $owner->post('/shifts', ['registerId' => $register['id'], 'openingFloat' => '0']);
        $cash = collect($owner->get('/payment-methods')->body)->firstWhere('kind', 'cash');
        $sale = $owner->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $p['variants'][1]['id'], 'quantity' => '2']],
            'payments' => [['paymentMethodId' => $cash['id'], 'amount' => '30000']], 'expectedTotal' => '30000.00',
        ]);
        $this->assertSame(201, $sale->status, json_encode($sale->body));
        $this->assertSame('Remera lisa · M / Rojo', $sale->body['lines'][0]['description']);
        $this->assertSame('3.000', $owner->get("/products/{$p['id']}")->body['variants'][1]['stock']);

        // Sin stock (la tienda de ropa no vende en negativo): el mensaje dice qué variante falta.
        $short = $owner->post('/sales', [
            'clientUuid' => self::uuid(), 'registerId' => $register['id'], 'lines' => [['variantId' => $p['variants'][2]['id'], 'quantity' => '1']],
            'payments' => [['paymentMethodId' => $cash['id'], 'amount' => '17000']], 'expectedTotal' => '17000.00',
        ]);
        $this->assertSame('INSUFFICIENT_STOCK', $short->body['code']);
        $this->assertStringContainsString('Remera lisa · XL / Negro (hay 0)', $short->body['message']);

        // Las filas de stock son por variante.
        $rows = collect($owner->get('/stock?q=remera')->body['items']);
        $this->assertSame(['M / Rojo', 'S / Rojo', 'XL / Negro'], $rows->pluck('variantLabel')->all());
    }

    public function test_editar_variantes_agrega_quita_y_recupera_combinaciones(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant(['businessTypeCode' => 'ropa']);
        $this->withPlan($tenantId, 'multisucursal');
        $body = fn (array $dto, array $variants) => [...self::productUpdate($dto), 'variants' => $variants];
        $keep = fn (array $v, array $extra = []) => [
            'id' => $v['id'], 'options' => $v['options'], 'sku' => $v['sku'], 'price' => $v['price'], 'cost' => $v['cost'], 'barcodes' => $v['barcodes'], 'initialStock' => null, ...$extra,
        ];
        $new = fn (string $talle, ?string $stock = null) => ['id' => null, 'options' => [$talle], 'sku' => null, 'price' => '9000', 'cost' => null, 'barcodes' => [], 'initialStock' => $stock];
        $p = $this->createProduct($owner, ['name' => 'Zapatilla', 'optionNames' => ['Talle'], 'variants' => [$new('38', '2'), $new('39')]]);
        [, $t39] = $p['variants'];

        // Agregar el 40 con stock y cambiar el precio del 39.
        $res = $owner->put("/products/{$p['id']}", $body($p, [$keep($p['variants'][0]), $keep($t39, ['price' => '9500']), $new('40', '4')]));
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame(['38', '39', '40'], array_column($res->body['variants'], 'label'));
        $this->assertSame('9500.00', $res->body['variants'][1]['price']);
        $this->assertSame('4.000', $res->body['variants'][2]['stock']);

        // El 38 tiene stock: no se puede quitar hasta llevarlo a cero.
        $p = $res->body;
        $blocked = $owner->put("/products/{$p['id']}", $body($p, [$keep($p['variants'][1]), $keep($p['variants'][2])]));
        $this->assertSame(409, $blocked->status);
        $this->assertStringContainsString('38', $blocked->body['message']);

        // El 39 no tiene stock: se quita y deja de aparecer para vender.
        $res = $owner->put("/products/{$p['id']}", $body($p, [$keep($p['variants'][0]), $keep($p['variants'][2])]));
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame(['38', '40'], array_column($res->body['variants'], 'label'));
        $this->assertSame([], $owner->get('/products/items?q=zapatilla+39')->body['items']);

        // Volver a cargar el 39 recupera la misma variante, con su historial de precios.
        $p = $res->body;
        $res = $owner->put("/products/{$p['id']}", $body($p, [...array_map(fn ($v) => $keep($v), $p['variants']), $new('39')]));
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame($t39['id'], collect($res->body['variants'])->firstWhere('label', '39')['id']);

        $history = $owner->get("/products/{$p['id']}/history")->body;
        $this->assertContains('39', array_column($history['prices'], 'variantLabel'));
        $this->assertArrayHasKey('variants', $history['changes'][0]['after']);
    }

    public function test_variantes_validan_combinaciones_y_dependen_del_plan(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant(['businessTypeCode' => 'ropa']);
        $v = fn (array $options) => ['id' => null, 'options' => $options, 'sku' => null, 'price' => '100', 'cost' => null, 'barcodes' => [], 'initialStock' => null];
        $input = self::productInput(['optionNames' => ['Talle'], 'variants' => [$v(['M']), $v(['L'])]]);

        $plan = $owner->post('/products', $input);
        $this->assertSame(400, $plan->status);
        $this->assertSame('VARIANTS_PLAN', $plan->body['code']);

        $this->withPlan($tenantId, 'multisucursal');
        $bad = $owner->post('/products', self::productInput(['optionNames' => ['Talle', 'talle'], 'variants' => [$v(['M', 'X']), $v(['m', 'x']), $v(['L'])]]));
        $this->assertSame(400, $bad->status);
        $paths = array_column($bad->body['details'], 'path');
        $this->assertContains('optionNames.1', $paths);
        $this->assertContains('variants.1.options', $paths);
        $this->assertContains('variants.2.options', $paths);

        $noOptions = $owner->post('/products', self::productInput(['variants' => [$v([]), $v([])]]));
        $this->assertSame('optionNames', $noOptions->body['details'][0]['path']);

        $created = $owner->post('/products', $input);
        $this->assertSame(201, $created->status);

        // Al bajar de plan se siguen editando las variantes existentes, pero no se agregan nuevas.
        $this->withPlan($tenantId, 'inicial');
        $dto = $created->body;
        $this->assertSame(200, $owner->put("/products/{$dto['id']}", self::productUpdate($dto, ['price' => '120']))->status);
        $dto = $owner->get("/products/{$dto['id']}")->body;
        $more = [...self::productUpdate($dto), 'variants' => [...self::productUpdate($dto)['variants'], $v(['XL'])]];
        $this->assertSame('VARIANTS_PLAN', $owner->put("/products/{$dto['id']}", $more)->body['code']);
    }

    /** Etiquetas: lo que no tiene código recibe un EAN-13 interno (prefijo 29) que el lector encuentra. */
    public function test_genera_codigos_internos_para_lo_que_no_tiene(): void
    {
        $this->assertSame('4006381333931', ProductsController::ean13('400638133393'));
        ['client' => $owner] = $this->registerTenant();
        $with = $this->createProduct($owner);
        $without = $this->createProduct($owner, ['barcodes' => []]);
        $other = $this->createProduct($owner, ['barcodes' => []]);

        $res = $owner->post('/products/barcodes', ['variantIds' => [$with['variantId'], $without['variantId']]]);
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame(1, $res->body['generated']);
        $this->assertSame($with['variants'][0]['barcodes'], $res->body['items'][0]['barcodes']);
        $code = $res->body['items'][1]['barcodes'][0]['code'];
        $this->assertMatchesRegularExpression('/^29\d{11}$/', $code);
        $this->assertSame($code, ProductsController::ean13(substr($code, 0, 12)));
        $this->assertSame($without['variantId'], $owner->get('/products/lookup?code='.$code)->body['item']['variantId']);

        // No se repiten ni se pisan: el siguiente toma el número que sigue.
        $this->assertSame(0, $owner->post('/products/barcodes', ['variantIds' => [$without['variantId']]])->body['generated']);
        $next = $owner->post('/products/barcodes', ['variantIds' => [$other['variantId']]])->body['items'][0]['barcodes'][0]['code'];
        $this->assertSame((int) substr($code, 2, 10) + 1, (int) substr($next, 2, 10));
    }

    private function withPlan(string $tenantId, string $code): void
    {
        app(TenantContext::class)->withoutTenant(function () use ($tenantId, $code) {
            DB::table('subscriptions')->where('tenant_id', $tenantId)->update(['plan_id' => DB::table('plans')->where('code', $code)->value('id')]);
        });
    }
}
