<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Settlement extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['closed_at' => 'datetime'];
}
