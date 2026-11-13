<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Pertenencia de un usuario a un comercio, con su rol. */
class Membership extends BaseModel
{
    use BelongsToTenant;
}
