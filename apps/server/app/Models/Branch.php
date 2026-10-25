<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Branch extends BaseModel
{
    use BelongsToTenant;
}
