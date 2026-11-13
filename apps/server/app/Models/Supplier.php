<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Proveedor del comercio. No se borra: se desactiva. */
class Supplier extends BaseModel
{
    use BelongsToTenant;
}
