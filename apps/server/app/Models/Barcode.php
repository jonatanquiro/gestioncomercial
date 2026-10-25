<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Código de barras de una variante. quantity_factor > 1 es un código de pack. */
class Barcode extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;
}
