<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class PaymentMethod extends BaseModel
{
    use BelongsToTenant;

    /**
     * Medios que pone el sistema y no se configuran ni se eligen como un medio más: el crédito
     * de un cambio y el saldo de una gift card. No mueven efectivo ni son cobros a rendir.
     */
    public const INTERNAL_KINDS = ['exchange', 'gift_card'];

    /** Lo que no es un cobro a conciliar y rendir: el efectivo y los medios internos. */
    public const NOT_SETTLED_KINDS = ['cash', 'exchange', 'gift_card'];

    protected $casts = ['requires_reference' => 'boolean', 'active' => 'boolean'];
}
