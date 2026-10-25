<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Inventario físico total o parcial de un depósito. */
class StockCount extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['closed_at' => 'datetime'];
}
