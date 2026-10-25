<?php

namespace App\Models;

class PlatformUser extends BaseModel
{
    const UPDATED_AT = null;

    protected $hidden = ['password_hash', 'totp_secret_enc'];
}
