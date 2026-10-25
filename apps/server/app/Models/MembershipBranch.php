<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** Sucursales donde opera cada empleado. */
class MembershipBranch extends Model
{
    use BelongsToTenant;

    protected $primaryKey = null;

    public $incrementing = false;

    public $timestamps = false;

    protected $guarded = [];
}
