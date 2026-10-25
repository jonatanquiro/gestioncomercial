<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class PaymentMethod extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['requires_reference' => 'boolean', 'active' => 'boolean'];
}
