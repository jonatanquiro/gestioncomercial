<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class FiscalInvoice extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['payload' => 'array', 'point_of_sale' => 'integer', 'voucher_type' => 'integer', 'number' => 'integer'];
}
