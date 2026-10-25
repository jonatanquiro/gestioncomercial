<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Venta confirmada. No se borra ni se edita: se anula. */
class Sale extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['confirmed_at' => 'datetime', 'voided_at' => 'datetime', 'number' => 'integer'];
}
