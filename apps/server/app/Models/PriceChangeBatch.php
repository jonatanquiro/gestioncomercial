<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Cambio masivo de precios aplicado. */
class PriceChangeBatch extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['scope' => 'array', 'rule' => 'array', 'applied_at' => 'datetime'];
}
