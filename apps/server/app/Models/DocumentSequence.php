<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Próximo número por sucursal y tipo de comprobante; se bloquea con FOR UPDATE al numerar. */
class DocumentSequence extends BaseModel
{
    use BelongsToTenant;

    public $timestamps = false;
}
