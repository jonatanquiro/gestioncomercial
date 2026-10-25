<?php

namespace App\Support;

use RuntimeException;

/**
 * Catálogos fijos (permisos, roles plantilla, rubros, límites y funciones de planes).
 * La fuente única es packages/contracts; database/catalog.json se genera desde ahí.
 */
class Catalog
{
    private static ?array $data = null;

    public static function all(): array
    {
        if (self::$data === null) {
            $raw = file_get_contents(database_path('catalog.json'));
            $decoded = $raw === false ? null : json_decode($raw, true);
            if (! is_array($decoded)) {
                throw new RuntimeException('database/catalog.json no existe o es inválido');
            }
            self::$data = $decoded;
        }

        return self::$data;
    }

    /** @return list<string> */
    public static function permissionCodes(): array
    {
        return array_column(self::all()['permissions'], 'code');
    }

    public static function roleTemplates(): array
    {
        return self::all()['roleTemplates'];
    }

    public static function businessTypes(): array
    {
        return self::all()['businessTypes'];
    }

    /** @return list<string> */
    public static function taxConditions(): array
    {
        return self::all()['taxConditions'];
    }

    /** @return list<string> */
    public static function planLimitKeys(): array
    {
        return self::all()['planLimitKeys'];
    }

    /** @return list<string> */
    public static function planFeatures(): array
    {
        return self::all()['planFeatures'];
    }
}
