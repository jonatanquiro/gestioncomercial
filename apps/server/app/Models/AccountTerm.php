<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Plazo para pagar a precio de contado lo que una venta dejó a cuenta corriente (ADR 0029). */
class AccountTerm extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['due_on' => 'date:Y-m-d'];
}
