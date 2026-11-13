<?php

namespace Tests\Feature;

use App\Http\Controllers\ProductsController;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** Importación de productos desde una planilla (ADR 0022): vista previa, errores por fila, variantes y precios. */
class ProductImportTest extends TestCase
{
    private static function row(int $n, array $fields, array $options = []): array
    {
        return ['row' => $n, 'options' => $options] + $fields;
    }

    private static function code(): string
    {
        return '779'.str_pad((string) random_int(0, 9999999999), 10, '0', STR_PAD_LEFT);
    }

    private function import(ApiClient $client, array $rows, bool $dryRun, array $extra = [])
    {
        return $client->post('/products/import', $extra + ['rows' => $rows, 'optionNames' => [], 'updateExisting' => false, 'dryRun' => $dryRun]);
    }

    public function test_kiosco_vista_previa_e_importacion_con_categorias_nuevas(): void
    {
        ['client' => $owner] = $this->registerTenant();
        [$a, $b] = [self::code(), self::code()];
        $rows = [
            self::row(2, ['name' => 'Alfajor triple', 'barcode' => $a, 'price' => '$ 1.250,50', 'cost' => '800', 'initialStock' => '24', 'category' => 'Alfajores importados', 'brand' => 'Havanna', 'vatRate' => '21%']),
            self::row(3, ['name' => 'Queso cremoso', 'barcode' => $b, 'price' => '9800.456', 'saleMode' => 'kg', 'vatRate' => '10,5', 'category' => 'alfajores IMPORTADOS']),
        ];
        $preview = $this->import($owner, $rows, true);
        $this->assertSame(200, $preview->status, json_encode($preview->body));
        $this->assertSame(['products' => 2, 'variants' => 2, 'updated' => 0, 'unchanged' => 0, 'skipped' => 0, 'errors' => 0], $preview->body['summary']);
        $this->assertSame(['Alfajores importados'], $preview->body['newCategories']);
        $this->assertSame(['Havanna'], $preview->body['newBrands']);
        $this->assertSame(['1250.50', '9800.46'], array_column($preview->body['rows'], 'price'));
        $this->assertSame(404, $owner->get("/products/lookup?code={$a}")->status, 'La vista previa no crea nada');

        $done = $this->import($owner, $rows, false);
        $this->assertSame(200, $done->status, json_encode($done->body));
        $alfajor = $owner->get("/products/lookup?code={$a}")->body['item'];
        $this->assertSame(['1250.50', '800.0000', '24.000', 'unit'], [$alfajor['price'], $alfajor['cost'], $alfajor['stock'], $alfajor['saleMode']]);
        $queso = $owner->get('/products/'.$owner->get("/products/lookup?code={$b}")->body['item']['productId'])->body;
        $this->assertSame(['weight', '10.5'], [$queso['saleMode'], $queso['vatRate']]);
        $this->assertCount(1, array_filter($owner->get('/categories')->body, fn ($c) => mb_strtolower($c['name']) === 'alfajores importados'));
        $this->assertStringContainsString('products.imported', json_encode($owner->get('/audit')->body));
    }

    public function test_errores_por_fila_y_no_importa_nada(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $dup = self::code();
        $rows = [
            self::row(2, ['name' => 'Bueno', 'barcode' => self::code(), 'price' => '100']),
            self::row(3, ['name' => '', 'price' => '100']),
            self::row(4, ['name' => 'Sin precio']),
            self::row(5, ['name' => 'Precio raro', 'price' => 'abc']),
            self::row(6, ['name' => 'Uno', 'barcode' => $dup, 'price' => '1']),
            self::row(7, ['name' => 'Dos', 'barcode' => $dup, 'price' => '1']),
            self::row(8, ['name' => 'IVA mal', 'price' => '1', 'vatRate' => '19']),
            self::row(9, ['name' => 'Repetido', 'price' => '1']),
            self::row(10, ['name' => 'repetido', 'price' => '2']),
        ];
        $preview = $this->import($owner, $rows, true)->body;
        $byRow = collect($preview['errors'])->groupBy('row')->map(fn ($e) => $e->pluck('message')->all());
        $this->assertSame(['Falta el nombre'], $byRow[3]);
        $this->assertSame(['Precio: Falta el precio'], $byRow[4]);
        $this->assertSame(['Precio: Importe inválido'], $byRow[5]);
        $this->assertStringContainsString('repetido (también en la fila 6)', $byRow[7][0]);
        $this->assertStringContainsString('«19» no es válido', $byRow[8][0]);
        $this->assertStringContainsString('aparece en varias filas', $byRow[9][0]);
        $this->assertArrayNotHasKey(2, $byRow->all());

        $res = $this->import($owner, $rows, false);
        $this->assertSame(['IMPORT_INVALID', 400], [$res->body['code'], $res->status]);
        $this->assertSame(0, $owner->get('/products')->body['total']);
    }

    public function test_variantes_por_nombre_con_talle_y_color(): void
    {
        ['client' => $owner, 'tenantId' => $tenantId] = $this->registerTenant(['businessTypeCode' => 'ropa']);
        $rows = [
            self::row(2, ['name' => 'Remera lisa', 'price' => '12000', 'initialStock' => '3', 'category' => 'Remeras'], ['S', 'Blanco']),
            self::row(3, ['name' => 'Remera lisa', 'price' => '12000', 'initialStock' => '5'], ['M', 'Blanco']),
            self::row(4, ['name' => 'Remera lisa', 'price' => '12500'], ['L', 'Negro']),
            self::row(5, ['name' => 'Gorra', 'price' => '8000'], ['', '']),
            self::row(6, ['name' => 'Buzo', 'price' => '20000'], ['M', '']),
        ];
        $extra = ['optionNames' => ['Talle', 'Color']];
        $this->usePlan($tenantId, []);
        $noPlan = $this->import($owner, $rows, true, $extra)->body;
        $this->assertSame([null], array_column(array_filter($noPlan['errors'], fn ($e) => str_contains($e['message'], 'variantes')), 'row'));

        $this->usePlan($tenantId, ['variants']);
        $preview = $this->import($owner, $rows, true, $extra)->body;
        $this->assertSame(0, $preview['summary']['errors'], json_encode($preview['errors']));
        $this->assertSame([3, 5], [$preview['summary']['products'], $preview['summary']['variants']]);
        $this->assertSame(['S / Blanco', 'M / Blanco', 'L / Negro', null, 'M'], array_column($preview['rows'], 'variant'));
        $this->assertSame(200, $this->import($owner, $rows, false, $extra)->status);

        $remera = collect($owner->get('/products?q=Remera')->body['items'])->first();
        $detail = $owner->get("/products/{$remera['id']}")->body;
        $this->assertSame(['Talle', 'Color'], $detail['optionNames']);
        $this->assertSame(['S / Blanco', 'M / Blanco', 'L / Negro'], array_column($detail['variants'], 'label'));
        $buzo = $owner->get('/products/'.collect($owner->get('/products?q=Buzo')->body['items'])->first()['id'])->body;
        $this->assertSame(['Talle'], $buzo['optionNames']);
    }

    public function test_existentes_actualizan_precio_solo_si_se_pide(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $code = self::code();
        $p = $this->createProduct($owner, ['price' => '1000', 'initialStock' => '10', 'barcodes' => [['code' => $code, 'quantityFactor' => '1']]]);
        $same = self::code();
        $this->createProduct($owner, ['price' => '500', 'barcodes' => [['code' => $same, 'quantityFactor' => '1']]]);
        $rows = [
            self::row(2, ['name' => 'Otro nombre', 'barcode' => $code, 'price' => '1.150', 'cost' => '700', 'initialStock' => '99']),
            self::row(3, ['name' => 'Igual', 'barcode' => $same, 'price' => '500']),
        ];
        $skip = $this->import($owner, $rows, true)->body;
        $this->assertSame(['skip', 'skip'], array_column($skip['rows'], 'action'));
        $this->assertSame('NOTHING_TO_IMPORT', $this->import($owner, $rows, false)->body['code']);

        $preview = $this->import($owner, $rows, true, ['updateExisting' => true])->body;
        $this->assertSame(['update', 'unchanged'], array_column($preview['rows'], 'action'));
        $this->assertSame(['1150.00', '1000.00'], [$preview['rows'][0]['price'], $preview['rows'][0]['oldPrice']]);
        $this->assertStringContainsString('no se toca el stock', implode(' ', $preview['warnings']));
        $this->assertSame(200, $this->import($owner, $rows, false, ['updateExisting' => true])->status);
        $item = $owner->get("/products/lookup?code={$code}")->body['item'];
        $this->assertSame(['1150.00', '700.0000', '10.000'], [$item['price'], $item['cost'], $item['stock']]);
        $this->assertSame($p['id'], $item['productId']);
    }

    public function test_numeros_como_los_escribe_la_gente(): void
    {
        $cases = ['1.250,50' => '1250.50', '$ 1.250' => '1250.00', '1250.5' => '1250.50', '1,5' => '1.50', '1,250,000' => '1250000.00', '12.345.678' => '12345678.00', '0.30000000000000004' => '0.30', 'abc' => null, '-5' => null];
        foreach ($cases as $raw => $expected) {
            $this->assertSame($expected, ProductsController::importDecimal($raw, 2), $raw);
        }
    }
}
