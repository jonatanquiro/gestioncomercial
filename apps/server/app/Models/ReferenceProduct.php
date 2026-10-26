<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Producto del catálogo de referencia (datos abiertos). Común a todos los comercios: no usa BelongsToTenant. */
class ReferenceProduct extends Model
{
    protected $primaryKey = 'code';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = ['seen_in' => 'integer'];

    /** Clave con la que se guarda un código: solo dígitos, sin ceros a la izquierda. Null si no es un GTIN válido. */
    public static function key(string $code): ?string
    {
        $code = trim($code);
        if (! preg_match('/^\d{8,14}$/', $code) || ! self::validCheckDigit($code)) {
            return null;
        }
        $key = ltrim($code, '0');

        return strlen($key) >= 6 ? $key : null;
    }

    /** Dígito verificador GS1 (EAN-8, UPC-A, EAN-13, GTIN-14). */
    private static function validCheckDigit(string $code): bool
    {
        $digits = array_reverse(str_split($code));
        $sum = 0;
        foreach (array_slice($digits, 1) as $i => $d) {
            $sum += (int) $d * ($i % 2 === 0 ? 3 : 1);
        }

        return (10 - $sum % 10) % 10 === (int) $digits[0];
    }
}
