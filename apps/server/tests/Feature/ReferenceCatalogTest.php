<?php

namespace Tests\Feature;

use App\Models\ReferenceProduct;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;
use ZipArchive;

/** Catálogo de referencia: importación de SEPA (Precios Claros) y sugerencia al cargar un código. */
class ReferenceCatalogTest extends TestCase
{
    private const HEADER = 'id_comercio|id_bandera|id_sucursal|id_producto|productos_ean|productos_descripcion|productos_cantidad_presentacion|productos_unidad_medida_presentacion|productos_marca|productos_precio_lista|productos_precio_referencia|productos_cantidad_referencia|productos_unidad_medida_referencia|productos_precio_unitario_promo1|productos_leyenda_promo1|productos_precio_unitario_promo2|productos_leyenda_promo2';

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir().'/sepa-test-'.bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/*') as $f) {
            unlink($f);
        }
        rmdir($this->dir);
        parent::tearDown();
    }

    public function test_importa_el_zip_del_dia_con_un_zip_por_cadena(): void
    {
        $gaseosa = self::ean('779089500');
        $alfajor = self::ean('779458000');
        $upc = self::gtin('01234567890'); // UPC-A de 12 dígitos

        // Cadena 1: dos sucursales con el mismo producto, descripción en mayúsculas, y un código interno.
        $chain1 = $this->csv([
            [1, 1, 1, $gaseosa, 1, 'GASEOSA COLA SABOR ORIGINAL 2.25 LT', '2.25', 'lt', 'COCA COLA', '3500.00'],
            [1, 1, 2, $gaseosa, 1, 'GASEOSA COLA SABOR ORIGINAL 2.25 LT', '2.25', 'lt', 'COCA COLA', '3600.00'],
            [1, 1, 1, '12345', 0, 'Pan de la casa', '1', 'kg', 'Sin marca', '2000.00'],
            [1, 1, 1, $alfajor, 1, 'Alfajor Triple Chocolate', '75.00', 'GR', 'Havanna', '1200.00'],
        ]);
        // Cadena 2: misma gaseosa con mejor descripción, un código con dígito verificador inválido y el UPC.
        $chain2 = $this->csv([
            [2, 1, 1, $gaseosa, 1, 'Gaseosa Coca-Cola Sabor Original 2,25 L', '2250', 'ml', 'Coca-Cola', '3400.00'],
            [2, 1, 1, '7790000000001', 1, 'Código roto', '1', 'un', 'X', '10.00'],
            [2, 1, 1, $upc, 1, 'Chicle menta', '1', 'un', 'Beldent', '300.00'],
        ]);
        $zip = $this->dir.'/sepa_lunes.zip';
        $inner = [];
        foreach (['sepa_1_comercio-sepa-1.zip' => $chain1, 'sepa_1_comercio-sepa-2.zip' => $chain2] as $name => $csv) {
            $path = $this->dir.'/'.$name;
            $z = new ZipArchive;
            $z->open($path, ZipArchive::CREATE);
            $z->addFromString('productos.csv', $csv);
            $z->addFromString('comercio.csv', "id_comercio|comercio_razon_social\n1|Cadena\n");
            $z->close();
            $inner[$name] = $path;
        }
        $z = new ZipArchive;
        $z->open($zip, ZipArchive::CREATE);
        foreach ($inner as $name => $path) {
            $z->addFile($path, $name);
        }
        $z->close();

        $this->assertSame(0, Artisan::call('catalogo:importar-sepa', ['ruta' => $zip]));
        $this->assertStringContainsString('3 productos con código de barras', Artisan::output());

        $g = ReferenceProduct::find(ReferenceProduct::key($gaseosa));
        $this->assertSame('Gaseosa Coca-Cola Sabor Original 2,25 L', $g->name, 'Prefiere la descripción que no está en mayúsculas');
        $this->assertSame('Coca-Cola', $g->brand);
        $this->assertSame('2250 ml', $g->presentation);
        $this->assertSame(2, $g->seen_in);
        $a = ReferenceProduct::find(ReferenceProduct::key($alfajor));
        $this->assertSame(['Alfajor Triple Chocolate', 'Havanna', '75 g', 1], [$a->name, $a->brand, $a->presentation, $a->seen_in]);
        $this->assertNull(ReferenceProduct::find('12345'));
        $this->assertNull(ReferenceProduct::find('7790000000001'));

        // El UPC-A se encuentra igual si el lector lo devuelve como EAN-13 (con un cero adelante).
        ['client' => $owner] = $this->registerTenant();
        $ref = $owner->get('/products/reference?code=0'.$upc);
        $this->assertSame(200, $ref->status);
        $this->assertSame(['Chicle menta', 'Beldent', '1 un'], [$ref->body['name'], $ref->body['brandName'], $ref->body['presentation']]);
        $this->assertSame('Alfajor Triple Chocolate', $owner->get("/products/reference?code={$alfajor}")->body['name']);
        $this->assertSame(404, $owner->get('/products/reference?code='.self::ean('779999999'))->status);
        $this->assertSame(404, $owner->get('/products/reference?code=hola')->status);
    }

    public function test_acepta_un_productos_csv_suelto_y_reimportar_actualiza(): void
    {
        $code = self::ean('779123450');
        $path = $this->dir.'/productos.csv';
        file_put_contents($path, $this->csv([[3, 1, 1, $code, 1, 'YERBA MATE SUAVE', '500', 'gr', 'LA MERCED', '4000']]));
        $this->assertSame(0, Artisan::call('catalogo:importar-sepa', ['ruta' => $path]));
        $this->assertSame(['Yerba Mate Suave', 'La Merced', '500 g'], [
            ReferenceProduct::find($code)->name, ReferenceProduct::find($code)->brand, ReferenceProduct::find($code)->presentation,
        ]);

        file_put_contents($path, $this->csv([[3, 1, 1, $code, 1, 'Yerba mate suave La Merced 500 g', '500', 'gr', 'La Merced', '4100']]));
        $this->assertSame(0, Artisan::call('catalogo:importar-sepa', ['ruta' => $this->dir]));
        $this->assertSame('Yerba mate suave La Merced 500 g', ReferenceProduct::find($code)->name);
    }

    public function test_rechaza_un_archivo_que_no_es_de_sepa(): void
    {
        $path = $this->dir.'/productos.csv';
        file_put_contents($path, "codigo;nombre\n123;algo\n");
        $this->assertSame(1, Artisan::call('catalogo:importar-sepa', ['ruta' => $path]));
        $this->assertStringContainsString('no parece un productos.csv de SEPA', Artisan::output());
        $this->assertSame(1, Artisan::call('catalogo:importar-sepa', ['ruta' => $this->dir.'/no-existe.zip']));
    }

    public function test_la_sugerencia_requiere_permiso_para_crear_productos(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $cashier = $this->roleByTemplate($owner, 'cashier');
        $emp = $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $this->assertSame(403, $emp['client']->get('/products/reference?code='.self::ean('779089500'))->status);
    }

    public function test_busca_en_el_catalogo_y_agrega_varios_con_su_precio(): void
    {
        $tag = 'Prueba'.random_int(100000, 999999);
        $alfajor = self::ean('779458001');
        $galletita = self::ean('779458002');
        $upc = self::gtin('0'.random_int(1000000000, 9999999999));
        $now = now()->format('Y-m-d H:i:s.u');
        ReferenceProduct::upsert([
            ['code' => $alfajor, 'name' => "Alfajor {$tag} chocolate", 'brand' => "Marca {$tag}", 'presentation' => '75 g', 'source' => 'sepa', 'seen_in' => 5, 'updated_at' => $now],
            ['code' => $galletita, 'name' => "Galletitas {$tag} dulces", 'brand' => "Marca {$tag}", 'presentation' => '300 g', 'source' => 'sepa', 'seen_in' => 3, 'updated_at' => $now],
            ['code' => ltrim($upc, '0'), 'name' => "Chicle {$tag}", 'brand' => null, 'presentation' => null, 'source' => 'sepa', 'seen_in' => 1, 'updated_at' => $now],
        ], ['code']);

        ['client' => $owner] = $this->registerTenant();
        $category = $owner->get('/categories')->body[0];
        // La marca ya existe en el comercio con otras mayúsculas: se reutiliza.
        $brand = $owner->post('/brands', ['name' => "MARCA {$tag}"])->body;

        $found = $owner->get('/products/reference/search?q='.urlencode("{$tag} chocolate"))->body;
        $this->assertSame(1, $found['total']);
        $this->assertSame([$alfajor, false], [$found['items'][0]['code'], $found['items'][0]['added']]);
        $this->assertSame(3, $owner->get("/products/reference/search?q={$tag}")->body['total']);
        $this->assertSame("Chicle {$tag}", $owner->get("/products/reference/search?q={$upc}")->body['items'][0]['name']);

        $res = $owner->post('/products/reference/add', ['categoryId' => $category['id'], 'items' => [
            ['code' => $alfajor, 'price' => '1500'], ['code' => $galletita, 'price' => '2300.50'], ['code' => $upc, 'price' => '300'],
        ]]);
        $this->assertSame(201, $res->status, json_encode($res->body));
        $this->assertSame(3, $res->body['created']);

        $p = $owner->get('/products/lookup?code='.$alfajor)->body['product'];
        $this->assertSame(["Alfajor {$tag} chocolate", '1500.00', $category['id'], $brand['id'], 'active', '0.000'], [
            $p['name'], $p['price'], $p['categoryId'], $p['brandId'], $p['status'], $p['stock'],
        ]);
        $this->assertSame('2300.50', $owner->get('/products/lookup?code='.$galletita)->body['product']['price']);
        $this->assertNull($owner->get('/products/lookup?code='.$upc)->body['product']['brandId']);
        $this->assertTrue($owner->get("/products/reference/search?q={$alfajor}")->body['items'][0]['added']);

        // Lo que ya está cargado no se duplica, y lo que no está en el catálogo se rechaza.
        $dup = $owner->post('/products/reference/add', ['categoryId' => null, 'items' => [['code' => $alfajor, 'price' => '1']]]);
        $this->assertSame([409, 'BARCODE_DUPLICATE'], [$dup->status, $dup->body['code']]);
        $missing = $owner->post('/products/reference/add', ['categoryId' => null, 'items' => [['code' => self::ean('779999998'), 'price' => '1']]]);
        $this->assertSame([400, 'items.0.code'], [$missing->status, $missing->body['details'][0]['path']]);
    }

    public function test_agregar_desde_el_catalogo_crea_la_marca_que_falta_y_respeta_el_permiso(): void
    {
        $tag = 'Nueva'.random_int(100000, 999999);
        $code = self::ean('779458003');
        ReferenceProduct::upsert([['code' => $code, 'name' => "Yerba {$tag}", 'brand' => "Marca {$tag}", 'presentation' => '1 kg', 'source' => 'sepa', 'seen_in' => 1, 'updated_at' => now()->format('Y-m-d H:i:s.u')]], ['code']);
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $this->assertSame(201, $owner->post('/products/reference/add', ['categoryId' => null, 'items' => [['code' => $code, 'price' => '5000']]])->status);
        $this->assertContains("Marca {$tag}", array_column($owner->get('/brands')->body, 'name'));

        $cashier = $this->roleByTemplate($owner, 'cashier');
        $emp = $this->addEmployee($owner, $cashier['id'], $me['branchIds']);
        $this->assertSame(403, $emp['client']->get('/products/reference/search?q=yerba')->status);
    }

    /** Arma un productos.csv con BOM, CRLF y la línea final de SEPA. */
    private function csv(array $rows): string
    {
        $lines = ["\xEF\xBB\xBF".self::HEADER];
        foreach ($rows as $r) {
            $lines[] = implode('|', array_pad($r, 17, ''));
        }
        $lines[] = 'Última actualización: 2026-10-26T08:00:00-03:00';

        return implode("\r\n", $lines)."\r\n";
    }

    private static function ean(string $prefix): string
    {
        return self::gtin(str_pad($prefix, 12, (string) random_int(0, 9)));
    }

    /** Agrega el dígito verificador GS1. */
    private static function gtin(string $body): string
    {
        $sum = 0;
        foreach (array_reverse(str_split($body)) as $i => $d) {
            $sum += (int) $d * ($i % 2 === 0 ? 3 : 1);
        }

        return $body.((10 - $sum % 10) % 10);
    }
}
