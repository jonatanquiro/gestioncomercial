<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Línea de venta con copias congeladas de descripción, precio, costo e IVA. */
class SaleLine extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;
}
