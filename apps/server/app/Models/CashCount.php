<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Arqueo parcial o de cierre (solo agregado). */
class CashCount extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['counted_at' => 'datetime'];
}
