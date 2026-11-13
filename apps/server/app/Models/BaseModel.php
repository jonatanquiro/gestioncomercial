<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/** Base de los modelos con PK UUID v7 (ordenable por tiempo) y fechas con microsegundos en UTC. */
abstract class BaseModel extends Model
{
    use HasUuids;

    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected $guarded = [];
}
