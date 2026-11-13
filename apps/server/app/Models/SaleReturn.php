<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Devolución de una venta, con su reintegro. */
class SaleReturn extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;

    protected $casts = ['number' => 'integer'];
}
