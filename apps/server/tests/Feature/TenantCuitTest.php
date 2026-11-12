<?php

namespace Tests\Feature;

use App\Models\PlatformUser;
use App\Services\PasswordService;
use Tests\Support\ApiClient;
use Tests\TestCase;

/** CUIT compartido (ADR 0025): el mismo dueño lo usa en varios comercios; otra persona, no. */
class TenantCuitTest extends TestCase
{
    private const ADMIN_PASSWORD = 'Plataforma-Segura-2026';

    private static function settings(ApiClient $client, string $cuit)
    {
        $t = $client->get('/tenant')->body;

        return $client->put('/tenant', [
            'tradeName' => $t['tradeName'], 'legalName' => null, 'cuit' => $cuit, 'taxCondition' => $t['taxCondition'],
            'address' => null, 'phone' => null, 'email' => null, 'settings' => $t['settings'],
        ]);
    }

    public function test_el_mismo_duenio_comparte_el_cuit_y_otra_persona_no(): void
    {
        $cuit = self::randomCuit();
        $first = $this->registerTenant(['cuit' => $cuit]);

        // Otra persona no puede registrar ni cargar ese CUIT.
        $other = $this->client()->post('/auth/register', [
            'tradeName' => 'Ajeno', 'taxCondition' => 'monotributo', 'businessTypeCode' => 'kiosco', 'ownerName' => 'Otra',
            'email' => self::uniqueEmail('otra'), 'password' => self::PASSWORD, 'cuit' => $cuit,
        ]);
        $this->assertSame(['CUIT_TAKEN', 409], [$other->body['code'], $other->status]);
        ['client' => $stranger] = $this->registerTenant();
        $this->assertSame('CUIT_TAKEN', self::settings($stranger, $cuit)->body['code']);

        // La plataforma da de alta un segundo comercio para el mismo dueño, con el mismo CUIT.
        PlatformUser::create(['email' => $admin = self::uniqueEmail('admin'), 'name' => 'Admin', 'password_hash' => app(PasswordService::class)->hash(self::ADMIN_PASSWORD)]);
        $platform = $this->client();
        $platform->post('/platform/auth/login', ['email' => $admin, 'password' => self::ADMIN_PASSWORD]);
        $second = $platform->post('/platform/tenants', [
            'tradeName' => 'Tienda de ropa', 'cuit' => $cuit, 'taxCondition' => 'monotributo', 'businessTypeCode' => 'ropa',
            'planCode' => 'profesional', 'ownerName' => 'Dueña', 'ownerEmail' => $first['input']['email'],
        ]);
        $this->assertSame(201, $second->status, json_encode($second->body));

        // El dueño puede volver a cargarlo en sus comercios.
        $this->assertSame(200, self::settings($first['client'], $cuit)->status);
        // Puede cambiarlo y volver a ponerlo.
        $this->assertSame(200, self::settings($first['client'], self::randomCuit())->status);
        $this->assertSame(200, self::settings($first['client'], $cuit)->status);
    }

    public function test_las_variantes_estan_en_todos_los_planes(): void
    {
        ['client' => $owner] = $this->registerTenant(['businessTypeCode' => 'ropa']);
        $this->assertContains('variants', $owner->get('/tenant')->body['plan']['features']);
    }
}
