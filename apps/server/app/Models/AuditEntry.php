<?php

namespace App\Models;

/**
 * Registro de auditoría (solo agregado: un disparador rechaza UPDATE y DELETE).
 * No usa BelongsToTenant porque guarda también eventos sin comercio (ingresos fallidos,
 * plataforma); las lecturas filtran explícitamente por tenant_id en AuditController.
 */
class AuditEntry extends BaseModel
{
    protected $table = 'audit_log';

    public $timestamps = false;

    protected $casts = ['before' => 'array', 'after' => 'array', 'at' => 'datetime'];
}
