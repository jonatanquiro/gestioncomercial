<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class SettlementItem extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['reviewed_at' => 'datetime'];
}
