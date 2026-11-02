<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Artículo recibido en una compra, con la descripción congelada como en la venta. */
class PurchaseLine extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;
}
