<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

class FiscalSetting extends BaseModel
{
    use BelongsToTenant;

    protected $hidden = ['certificate_enc', 'private_key_enc', 'ticket_enc'];

    protected $casts = ['ticket_expires_at' => 'datetime', 'point_of_sale' => 'integer', 'issuer_metadata' => 'array'];
}
