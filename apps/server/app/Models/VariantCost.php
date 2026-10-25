<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Historial de costos (solo agregado). */
class VariantCost extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['at' => 'datetime'];
}
