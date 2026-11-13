<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Ingreso de mercadería: suma stock y, si se pide, actualiza costos. No se edita. */
class Purchase extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;

    protected $casts = ['number' => 'integer', 'updated_costs' => 'boolean'];
}
