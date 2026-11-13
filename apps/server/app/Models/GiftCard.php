<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Gift card: saldo prepago que se usa como medio de pago hasta que vence (ADR 0015). */
class GiftCard extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['expires_on' => 'date'];
}
