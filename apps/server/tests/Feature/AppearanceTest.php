<?php

namespace Tests\Feature;

use App\Support\Appearance;
use Tests\TestCase;

class AppearanceTest extends TestCase
{
    public function test_apariencia_es_del_comercio_y_no_pisa_los_parametros_operativos(): void
    {
        ['client' => $a] = $this->registerTenant();
        ['client' => $b] = $this->registerTenant();
        $original = $a->get('/tenant')->body;
        $logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/ncAAAAASUVORK5CYII=';
        $settings = [...Appearance::DEFAULTS, 'logoData' => $logo, 'primaryColor' => '#065f46', 'menuColor' => '#14213a', 'font' => 'archivo', 'navigation' => 'top'];
        $res = $a->put('/tenant/appearance', $settings);
        $this->assertSame(200, $res->status, json_encode($res->body));
        $this->assertSame($settings, $res->body['appearance']);
        $this->assertSame($original['settings'], $res->body['settings']);
        $this->assertSame(Appearance::DEFAULTS, $b->get('/tenant')->body['appearance']);
        $invalid = $a->put('/tenant/appearance', [...$settings, 'primaryColor' => '#ffffff']);
        $this->assertSame(400, $invalid->status);
        $this->assertSame('primaryColor', $invalid->body['details'][0]['path']);
        $this->assertSame(400, $a->put('/tenant/appearance', [...$settings, 'logoData' => 'data:image/svg+xml;base64,PHN2Zy8+'])->status);
    }
}
