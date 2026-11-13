<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BusinessType extends Model
{
    protected $primaryKey = 'code';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'default_settings' => 'array',
        'default_categories' => 'array',
        'recommended_features' => 'array',
    ];
}
