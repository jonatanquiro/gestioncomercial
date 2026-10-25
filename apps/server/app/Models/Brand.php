<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Brand extends BaseModel
{
    use BelongsToTenant;

    const UPDATED_AT = null;
}
