<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\Support\ApiClient;

/**
 * Las pruebas corren contra MySQL/MariaDB real (base DB_TEST_DATABASE), sin simulaciones de la
 * base. Se migra una vez por ejecución y cada prueba crea sus propios comercios con datos
 * únicos, así que no hace falta vaciar tablas (la auditoría, además, no se puede borrar).
 */
abstract class TestCase extends BaseTestCase
{
    public const PASSWORD = 'clave-segura-de-prueba-1';

    private static bool $migrated = false;

    private static int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        if (! self::$migrated) {
            Artisan::call('migrate:fresh', ['--force' => true]);
            self::$migrated = true;
        }
        Mail::fake();
    }

    protected function client(): ApiClient
    {
        return new ApiClient($this);
    }

    protected static function uniqueEmail(string $prefix = 'user'): string
    {
        self::$seq++;

        return sprintf('%s.%s.%d.%d@test.local', $prefix, str_replace('.', '', (string) microtime(true)), self::$seq, random_int(0, 999999));
    }

    /**
     * Registra un comercio nuevo y devuelve el cliente con la sesión del propietario.
     *
     * @return array{client: ApiClient, input: array<string, mixed>, me: array<string, mixed>, tenantId: string}
     */
    protected function registerTenant(array $overrides = []): array
    {
        $client = $this->client();
        $input = array_merge([
            'tradeName' => 'Comercio '.random_int(0, 999999),
            'taxCondition' => 'monotributo',
            'businessTypeCode' => 'kiosco',
            'ownerName' => 'Dueña de Prueba',
            'email' => self::uniqueEmail('owner'),
            'password' => self::PASSWORD,
        ], $overrides);
        $res = $client->post('/auth/register', $input);
        $this->assertSame(201, $res->status, 'Registro falló: '.json_encode($res->body));
        $me = $client->get('/auth/me')->body;

        return ['client' => $client, 'input' => $input, 'me' => $me, 'tenantId' => $me['tenant']['id']];
    }

    /**
     * Crea un empleado con el rol indicado y devuelve un cliente con su sesión iniciada.
     *
     * @param  list<string>  $branchIds
     * @return array{client: ApiClient, email: string, membershipId: string}
     */
    protected function addEmployee(ApiClient $owner, string $roleId, array $branchIds): array
    {
        $email = self::uniqueEmail('emp');
        $res = $owner->post('/employees', ['name' => 'Empleado Prueba', 'email' => $email, 'password' => self::PASSWORD, 'roleId' => $roleId, 'branchIds' => $branchIds]);
        $this->assertSame(201, $res->status, 'Alta de empleado falló: '.json_encode($res->body));
        $client = $this->client();
        $this->assertSame(200, $client->post('/auth/login', ['login' => $email, 'password' => self::PASSWORD])->status);

        return ['client' => $client, 'email' => $email, 'membershipId' => $res->body['membershipId']];
    }

    /** @return list<array<string, mixed>> */
    protected function rolesOf(ApiClient $client): array
    {
        return $client->get('/roles')->body;
    }

    protected function roleByTemplate(ApiClient $client, string $template): array
    {
        foreach ($this->rolesOf($client) as $role) {
            if ($role['templateCode'] === $template) {
                return $role;
            }
        }
        $this->fail("No existe el rol plantilla {$template}");
    }

    /** Campos de la variante que las pruebas de un producto simple pasan aplanados. */
    private const VARIANT_KEYS = ['sku', 'price', 'cost', 'barcodes', 'initialStock'];

    /**
     * Cuerpo válido de alta de producto simple, con un código de barras único. sku, price, cost,
     * barcodes e initialStock pueden venir aplanados: van a la única variante.
     */
    protected static function productInput(array $overrides = []): array
    {
        self::$seq++;
        $variant = [
            'id' => null, 'options' => [], 'sku' => null, 'price' => '1000', 'cost' => '600',
            'barcodes' => [['code' => '779'.str_pad((string) random_int(0, 9999999999), 10, '0', STR_PAD_LEFT), 'quantityFactor' => '1']],
            'initialStock' => null,
        ];

        return array_merge([
            'kind' => 'good',
            'name' => 'Producto '.self::$seq.' '.random_int(0, 999999),
            'description' => null,
            'categoryId' => null,
            'brandId' => null,
            'saleMode' => 'unit',
            'vatRate' => '21',
            'trackStock' => true,
            'minStock' => null,
            'blockNegativeStock' => false,
            'optionNames' => [],
            'variants' => [array_merge($variant, array_intersect_key($overrides, array_flip(self::VARIANT_KEYS)))],
        ], array_diff_key($overrides, array_flip(self::VARIANT_KEYS)));
    }

    /** Crea un producto y devuelve su DTO, con variantId de la primera variante como atajo. */
    protected function createProduct(ApiClient $client, array $overrides = []): array
    {
        $res = $client->post('/products', self::productInput($overrides));
        $this->assertSame(201, $res->status, 'Alta de producto falló: '.json_encode($res->body));

        return $res->body + ['variantId' => $res->body['variants'][0]['id']];
    }

    /** Cuerpo de edición a partir del DTO actual. Los campos de variante aplanados van a la primera. */
    protected static function productUpdate(array $dto, array $overrides = []): array
    {
        $keys = ['kind', 'name', 'description', 'categoryId', 'brandId', 'saleMode', 'vatRate', 'trackStock', 'minStock', 'blockNegativeStock', 'optionNames', 'version'];
        $variants = array_map(fn ($v) => [
            'id' => $v['id'], 'options' => $v['options'], 'sku' => $v['sku'], 'price' => $v['price'], 'cost' => $v['cost'],
            'barcodes' => $v['barcodes'], 'initialStock' => null,
        ], $dto['variants']);
        $variants[0] = array_merge($variants[0], array_intersect_key($overrides, array_flip(self::VARIANT_KEYS)));

        return array_merge(array_intersect_key($dto, array_flip($keys)), ['variants' => $variants], array_diff_key($overrides, array_flip(self::VARIANT_KEYS)));
    }

    protected function defaultWarehouse(ApiClient $client): string
    {
        $warehouses = $client->get('/warehouses')->body;

        return collect($warehouses)->firstWhere('isDefault', true)['id'];
    }

    protected static function uuid(): string
    {
        return (string) Str::uuid7();
    }

    /** CUIT válido aleatorio (prefijo 30) para no chocar entre pruebas. */
    protected static function randomCuit(): string
    {
        $w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        while (true) {
            $base = '30'.str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
            $sum = 0;
            foreach ($w as $i => $x) {
                $sum += $x * (int) $base[$i];
            }
            $mod = 11 - ($sum % 11);
            if ($mod === 10) {
                continue;
            }

            return $base.($mod === 11 ? 0 : $mod);
        }
    }
}
