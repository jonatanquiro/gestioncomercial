<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Movimiento de la cuenta con un proveedor. De solo agregado. */
class SupplierMovement extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;
}
