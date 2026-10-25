<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Saldo materializado por depósito y variante. Solo lo modifica StockService, junto con un movimiento. */
class StockLevel extends BaseModel
{
    use BelongsToTenant;

    const CREATED_AT = null;
}
