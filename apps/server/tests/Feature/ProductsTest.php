<?php

namespace Tests\Feature;

use App\Support\Catalog;
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
        $this->assertSame($category['name'], $p['categoryName']);
        $this->assertSame($brand['name'], $p['brandName']);
        $this->assertSame('1000.00', $p['price']);
        $this->assertSame('600.0000', $p['cost']);
        $this->assertSame('24.000', $p['stock']);
        $this->assertCount(2, $p['barcodes']);

        foreach (['triple choc', '7790001112223', 'ALF-3'] as $term) {
            $ids = array_column($owner->get('/products?q='.urlencode($term))->body['items'], 'id');
            $this->assertSame([$p['id']], $ids, "Buscando {$term}");
        }

        // El código del pack representa 12 unidades.
        $pack = $owner->get('/products/lookup?code=17790001112220')->body;
        $this->assertSame($p['id'], $pack['product']['id']);
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
        $code = $p['barcodes'][0]['code'];

        $dup = $owner->post('/products', self::productInput(['barcodes' => [['code' => $code, 'quantityFactor' => '1']]]));
        $this->assertSame(409, $dup->status);
        $this->assertSame('BARCODE_DUPLICATE', $dup->body['code']);
        $this->assertStringContainsString($p['name'], $dup->body['message']);

        $sku = $owner->post('/products', self::productInput(['sku' => 'GAL-1']));
        $this->assertSame(409, $sku->status);
        $this->assertSame('SKU_DUPLICATE', $sku->body['code']);

        $same = $owner->post('/products', self::productInput(['barcodes' => [['code' => '111', 'quantityFactor' => '1'], ['code' => '111', 'quantityFactor' => '6']]]));
        $this->assertSame(400, $same->status);
        $this->assertContains('barcodes.1.code', array_column($same->body['details'], 'path'));

        // Editar el propio producto conservando su código no es un duplicado.
        $this->assertSame(200, $owner->put("/products/{$p['id']}", self::productUpdate($p, ['name' => 'Galletitas']))->status);
    }

    public function test_valida_importes_y_cantidades_como_texto_decimal(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $res = $owner->post('/products', self::productInput(['price' => 10.5, 'cost' => '1,5', 'minStock' => '2.5']));
        $this->assertSame(400, $res->status);
        $paths = array_column($res->body['details'], 'path');
        $this->assertContains('price', $paths);
        $this->assertContains('cost', $paths);

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
        $this->assertSame('1250.50', $updated->body['price']);
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
        $this->assertNull($seen['cost']);
        $this->assertSame([], $client->get("/products/{$p['id']}/history")->body['costs']);

        $ok = $client->put("/products/{$p['id']}", self::productUpdate($seen, ['name' => 'Editado por repositor']));
        $this->assertSame(200, $ok->status, json_encode($ok->body));
        $this->assertSame('450.0000', $owner->get("/products/{$p['id']}")->body['cost']);

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
}
