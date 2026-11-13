<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Pago de la suscripción: por Mercado Pago o registrado a mano desde la plataforma. */
class SubscriptionPayment extends BaseModel
{
    use BelongsToTenant;

    protected $casts = [
        'months' => 'integer',
        'period_from' => 'datetime',
        'period_to' => 'datetime',
        'details' => 'array',
        'checked_at' => 'datetime',
    ];
}
