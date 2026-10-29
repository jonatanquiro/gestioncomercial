<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/**
 * Lo que se vende, se stockea y tiene precio. options sigue el orden de products.option_names;
 * label es «M / Rojo», o null en el producto sin propiedades. Inactiva = quitada del producto.
 */
class ProductVariant extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['options' => 'array'];

    /** «Remera · M / Rojo»: así se muestra y se congela en la línea de venta. */
    public static function displayName(string $productName, ?string $label): string
    {
        return $label === null ? $productName : mb_substr("{$productName} · {$label}", 0, 160);
    }
}
