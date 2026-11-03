<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Promoción: porcentaje o N×M sobre todo, una categoría o un producto (ADR 0020). */
class Promotion extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['starts_on' => 'date', 'ends_on' => 'date', 'buy_quantity' => 'integer', 'pay_quantity' => 'integer'];
}
