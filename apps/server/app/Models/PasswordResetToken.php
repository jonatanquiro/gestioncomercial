<?php

namespace App\Models;

class PasswordResetToken extends BaseModel
{
    const UPDATED_AT = null;

    protected $casts = ['expires_at' => 'datetime', 'used_at' => 'datetime'];
}
