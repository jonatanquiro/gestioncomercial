<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Fila (plan_id, key) sin PK propia: se reemplazan en bloque al editar el plan. */
class PlanLimit extends Model
{
    protected $primaryKey = null;

    public $incrementing = false;

    public $timestamps = false;

    protected $guarded = [];
}
