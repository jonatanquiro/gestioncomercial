<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Cliente: datos para facturarle y su cuenta corriente (ADR 0016). */
class Customer extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['document_type' => 'integer', 'vat_condition' => 'integer'];
}
