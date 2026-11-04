<?php

namespace Tests\Feature;

use App\Auth\Cookies;
use Illuminate\Foundation\Testing\TestCase;

/** Verifica el montaje real de Laravel sin necesitar una base de datos. */
class DeploymentTest extends TestCase
{
    public function test_la_web_funciona_en_la_raiz(): void
    {
        $this->get('/login')->assertOk()
            ->assertSee('name="app-base-path" content=""', false)
            ->assertSee('src="/spa/assets/', false)
            ->assertSee('href="/spa/manifest.webmanifest"', false);
    }

    public function test_la_web_y_los_errores_api_funcionan_en_subcarpeta(): void
    {
        $this->withServerVariables([
            'SCRIPT_NAME' => '/gestion-comercial/index.php',
            'PHP_SELF' => '/gestion-comercial/index.php',
            'SCRIPT_FILENAME' => public_path('index.php'),
        ]);

        $this->get('/gestion-comercial/app/productos')->assertOk()
            ->assertSee('name="app-base-path" content="/gestion-comercial"', false)
            ->assertSee('src="/gestion-comercial/spa/assets/', false)
            ->assertSee('href="/gestion-comercial/spa/manifest.webmanifest"', false);

        $this->getJson('http://localhost/gestion-comercial/api/v1/no-existe')->assertNotFound()
            ->assertJsonStructure(['code', 'message', 'requestId']);
    }

    public function test_las_cookies_se_crean_y_se_borran_en_la_misma_subcarpeta(): void
    {
        config(['session.path' => '/gestion-comercial', 'session.secure' => true]);
        $session = Cookies::session(Cookies::SESSION, 'token', 3600);
        $this->assertSame('/gestion-comercial', $session->getPath());
        $this->assertTrue($session->isSecure());
        $this->assertSame('/gestion-comercial', Cookies::csrf('token')->getPath());
        $this->assertSame('/gestion-comercial', Cookies::forget(Cookies::SESSION)->getPath());
    }
}
