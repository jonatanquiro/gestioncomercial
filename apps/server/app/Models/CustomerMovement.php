<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Movimiento de la cuenta corriente de un cliente. De solo agregado. */
class CustomerMovement extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;
}
