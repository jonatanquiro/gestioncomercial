<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;

/** Vínculo rol-permiso. Sin PK propia: se reemplaza en bloque al editar el rol. */
class RolePermission extends Model
{
    use BelongsToTenant;

    protected $primaryKey = null;

    public $incrementing = false;

    public $timestamps = false;

    protected $guarded = [];
}
