<?php

namespace App\Models;

/**
 * El comercio. No usa BelongsToTenant porque es la raíz: los servicios lo buscan siempre por
 * el id del contexto (TenantContext), nunca por un id recibido en el pedido.
 */
class Tenant extends BaseModel
{
    protected $casts = ['settings' => 'array', 'appearance' => 'array', 'version' => 'integer'];
}
