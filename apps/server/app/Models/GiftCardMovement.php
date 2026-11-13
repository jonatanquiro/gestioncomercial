<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Movimiento del saldo de una gift card. De solo agregado. */
class GiftCardMovement extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;
}
