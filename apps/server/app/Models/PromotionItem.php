<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Producto de un combo y cuántas unidades lleva (ADR 0024). */
class PromotionItem extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['quantity' => 'integer'];
}
