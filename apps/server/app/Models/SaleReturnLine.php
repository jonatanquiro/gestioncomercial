<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class SaleReturnLine extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;

    protected $casts = ['restock' => 'boolean'];
}
