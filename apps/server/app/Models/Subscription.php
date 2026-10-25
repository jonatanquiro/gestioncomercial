<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class Subscription extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['trial_ends_at' => 'datetime', 'current_period_end' => 'datetime'];
}
