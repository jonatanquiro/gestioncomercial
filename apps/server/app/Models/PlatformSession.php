<?php

namespace App\Models;

class PlatformSession extends BaseModel
{
    const UPDATED_AT = null;

    protected $casts = ['last_seen_at' => 'datetime', 'expires_at' => 'datetime', 'revoked_at' => 'datetime'];
}
