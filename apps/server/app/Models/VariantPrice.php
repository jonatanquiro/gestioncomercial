<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Historial de precios: el vigente es la fila con is_current. */
class VariantPrice extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['is_current' => 'boolean', 'valid_from' => 'datetime', 'valid_to' => 'datetime'];
}
