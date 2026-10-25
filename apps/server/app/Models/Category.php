<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Category extends BaseModel
{
    use BelongsToTenant;
}
