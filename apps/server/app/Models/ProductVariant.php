<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class ProductVariant extends BaseModel
{
    use BelongsToTenant;
}
