<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Warehouse extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;

    protected $casts = ['is_default' => 'boolean'];
}
