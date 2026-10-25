<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class StockCountLine extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['counted_at' => 'datetime'];
}
