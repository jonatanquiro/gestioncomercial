<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Caja (punto de cobro) de una sucursal. */
class Register extends BaseModel
{
    use BelongsToTenant;
}
