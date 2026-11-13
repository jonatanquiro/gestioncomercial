<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Role extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['is_system' => 'boolean'];
}
