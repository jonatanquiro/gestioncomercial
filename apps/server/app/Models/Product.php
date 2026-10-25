<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;

/** Maestro del artículo. Nunca se borra: se desactiva. Lo que se vende y se stockea es su variante. */
class Product extends BaseModel
{
    use BelongsToTenant;

    protected $casts = ['track_stock' => 'boolean', 'block_negative_stock' => 'boolean', 'version' => 'integer'];
}
