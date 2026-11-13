<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Movimiento de stock (solo agregado: un disparador rechaza UPDATE y DELETE). */
class StockMovement extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['occurred_at' => 'datetime'];
}
