<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Turno de caja. Cerrado, un disparador impide modificarlo. */
class CashShift extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['opened_at' => 'datetime', 'closed_at' => 'datetime', 'totals_by_method' => 'array'];
}
