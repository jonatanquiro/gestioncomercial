<?php

namespace Tests\Feature;

use App\Support\Catalog;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class CatalogTest extends TestCase
{
    public function test_los_rubros_del_catalogo_se_listan_en_el_registro(): void
    {
        $res = $this->client()->get('/business-types');
        $this->assertSame(200, $res->status);
        $this->assertSame(array_column(Catalog::businessTypes(), 'code'), array_column($res->body, 'code'));
    }

    public function test_volver_a_migrar_sin_pendientes_repara_los_catalogos(): void
    {
        $code = Catalog::businessTypes()[0]['code'];
        DB::table('business_types')->where('code', $code)->update(['name' => 'Rubro roto']);
        DB::table('permissions')->where('code', Catalog::all()['permissions'][0]['code'])->update(['label' => 'Permiso roto']);

        $this->assertSame(0, Artisan::call('migrate'));

        $this->assertSame(Catalog::businessTypes()[0]['name'], DB::table('business_types')->where('code', $code)->value('name'));
        $this->assertSame(Catalog::all()['permissions'][0]['label'], DB::table('permissions')->where('code', Catalog::all()['permissions'][0]['code'])->value('label'));
    }
}
