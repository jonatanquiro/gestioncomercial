<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Movimiento de efectivo de un turno (solo agregado). */
class CashMovement extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['occurred_at' => 'datetime'];
}
