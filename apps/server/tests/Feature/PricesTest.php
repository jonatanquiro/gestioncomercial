<?php

namespace Tests\Feature;

use Tests\Support\ApiClient;
use Tests\TestCase;

/** Fase 3 · cambio masivo de precios con vista previa exacta, recargo y margen (sección 8 del diseño). */
class PricesTest extends TestCase
{
    private static function body(array $productIds, string $kind, string $value, int $step = 0): array
    {
        return ['scope' => ['categoryId' => null, 'brandId' => null, 'productIds' => $productIds], 'rule' => ['kind' => $kind, 'value' => $value], 'roundingStep' => $step];
    }

    private function preview(ApiClient $client, array $body): array
    {
        $res = $client->post('/prices/bulk/preview', $body);
        $this->assertSame(200, $res->status, json_encode($res->body));

        return $res->body;
    }

    public function test_recargo_y_margen_dan_los_valores_de_la_tabla_del_diseno(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $p = $this->createProduct($owner, ['cost' => '1000', 'price' => '1']);

        $markup = $this->preview($owner, self::body([$p['id']], 'markup', '30'))['rows'][0];
        $this->assertSame(['1300.00', '30.00', '23.08'], [$markup['newPrice'], $markup['markup'], $markup['margin']]);

        $margin = $this->preview($owner, self::body([$p['id']], 'margin', '30'))['rows'][0];
        $this->assertSame(['1428.57', '42.86', '30.00'], [$margin['newPrice'], $margin['markup'], $margin['margin']]);

        $rounded = $this->preview($owner, self::body([$p['id']], 'margin', '30', 10))['rows'][0];
        $this->assertSame('1430.00', $rounded['newPrice']);
    }

    public function test_aplica_exactamente_lo_que_mostro_la_vista_previa(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $category = $owner->post('/categories', ['name' => 'Bebidas frías'])->body['id'];
        $a = $this->createProduct($owner, ['categoryId' => $category, 'price' => '1000']);
        $b = $this->createProduct($owner, ['categoryId' => $category, 'price' => '1999.99']);
        $other = $this->createProduct($owner, ['price' => '500']);
        $body = ['scope' => ['categoryId' => $category, 'brandId' => null, 'productIds' => null], 'rule' => ['kind' => 'percent', 'value' => '12.5'], 'roundingStep' => 10];

        $preview = $this->preview($owner, $body);
        $rows = collect($preview['rows'])->keyBy('productId');
        $this->assertCount(2, $rows);
        $this->assertSame(['1000.00', '1130.00', '13.00'], [$rows[$a['id']]['oldPrice'], $rows[$a['id']]['newPrice'], $rows[$a['id']]['variation']]);
        $this->assertSame('2250.00', $rows[$b['id']]['newPrice']);

        $applied = $owner->post('/prices/bulk/apply', $body + ['fingerprint' => $preview['fingerprint']]);
        $this->assertSame(200, $applied->status, json_encode($applied->body));
        $this->assertSame(2, $applied->body['affectedCount']);
        $this->assertSame('1130.00', $owner->get("/products/{$a['id']}")->body['price']);
        $this->assertSame('2250.00', $owner->get("/products/{$b['id']}")->body['price']);
        $this->assertSame('500.00', $owner->get("/products/{$other['id']}")->body['price']);
        $history = $owner->get("/products/{$a['id']}/history")->body['prices'];
        $this->assertSame($applied->body['batchId'], $history[0]['batchId']);
        $this->assertSame('prices.bulk_updated', $owner->get('/audit')->body['items'][0]['action']);

        // Volver a aplicar la misma vista previa ya no coincide: los precios cambiaron.
        $again = $owner->post('/prices/bulk/apply', $body + ['fingerprint' => $preview['fingerprint']]);
        $this->assertSame(409, $again->status);
        $this->assertSame('PREVIEW_OUTDATED', $again->body['code']);
    }

    public function test_si_alguien_cambia_un_precio_despues_de_la_vista_previa_no_se_aplica(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $p = $this->createProduct($owner, ['price' => '100']);
        $body = self::body([$p['id']], 'fixed', '50');
        $preview = $this->preview($owner, $body);
        $owner->put("/products/{$p['id']}", self::productUpdate($p, ['price' => '120']));

        $res = $owner->post('/prices/bulk/apply', $body + ['fingerprint' => $preview['fingerprint']]);
        $this->assertSame(409, $res->status);
        $this->assertSame('120.00', $owner->get("/products/{$p['id']}")->body['price']);
    }

    public function test_omite_lo_que_no_se_puede_calcular_y_avisa_por_que(): void
    {
        ['client' => $owner] = $this->registerTenant();
        $noCost = $this->createProduct($owner, ['cost' => null]);
        $cheap = $this->createProduct($owner, ['price' => '30']);
        $markup = $this->preview($owner, self::body([$noCost['id']], 'markup', '40'));
        $this->assertSame([], $markup['rows']);
        $this->assertSame('No tiene costo cargado', $markup['skipped'][0]['reason']);

        $negative = $this->preview($owner, self::body([$cheap['id']], 'fixed', '-50'));
        $this->assertSame('El precio quedaría negativo', $negative['skipped'][0]['reason']);

        $this->assertSame(400, $owner->post('/prices/bulk/preview', self::body([$cheap['id']], 'margin', '100'))->status);
        $empty = $owner->post('/prices/bulk/apply', self::body([$cheap['id']], 'percent', '0') + ['fingerprint' => $this->preview($owner, self::body([$cheap['id']], 'percent', '0'))['fingerprint']]);
        $this->assertSame('NOTHING_TO_APPLY', $empty->body['code']);
    }

    public function test_recargo_y_margen_exigen_ver_costos(): void
    {
        ['client' => $owner, 'me' => $me] = $this->registerTenant();
        $p = $this->createProduct($owner);
        $role = $owner->post('/roles', ['name' => 'Precios sin costos', 'permissions' => ['products.read', 'prices.bulk_update']])->body;
        ['client' => $client] = $this->addEmployee($owner, $role['id'], $me['branchIds']);
        $this->assertSame(403, $client->post('/prices/bulk/preview', self::body([$p['id']], 'markup', '30'))->status);
        $percent = $this->preview($client, self::body([$p['id']], 'percent', '10'));
        $this->assertNull($percent['rows'][0]['cost']);
        $this->assertNull($percent['rows'][0]['margin']);
    }
}
