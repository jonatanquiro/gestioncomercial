<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class SalePayment extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;
}
