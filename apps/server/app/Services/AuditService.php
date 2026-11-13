<?php

namespace App\Services;

use App\Models\AuditEntry;
use Illuminate\Support\Carbon;

/**
 * Registra acciones críticas dentro de la misma transacción que la operación: si la
 * operación se deshace, la auditoría también; si se confirma, queda grabada.
 */
class AuditService
{
    /**
     * @param  array{tenantId: ?string, actorType: 'user'|'platform'|'system', actorId: ?string, actorName: ?string,
     *   action: string, entityType: string, entityId?: ?string, before?: mixed, after?: mixed, ip?: ?string, requestId?: ?string}  $e
     */
    public function record(array $e): void
    {
        AuditEntry::create([
            'tenant_id' => $e['tenantId'],
            'actor_type' => $e['actorType'],
            'actor_id' => $e['actorId'],
            'actor_name' => $e['actorName'],
            'action' => $e['action'],
            'entity_type' => $e['entityType'],
            'entity_id' => $e['entityId'] ?? null,
            'before' => $e['before'] ?? null,
            'after' => $e['after'] ?? null,
            'ip' => $e['ip'] ?? null,
            'request_id' => $e['requestId'] ?? null,
            'at' => Carbon::now(),
        ]);
    }
}
