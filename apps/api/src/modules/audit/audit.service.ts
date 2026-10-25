import { Injectable } from '@nestjs/common';
import { auditLog } from '../../db/schema';
import type { Tx } from '../../db/db.service';
import { uuidv7 } from '../../common/ids';

export interface AuditEntry {
  tenantId: string | null;
  actorType: 'user' | 'platform' | 'system';
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Registra acciones críticas dentro de la misma transacción que la operación:
 * si la operación se deshace, la auditoría también; si se confirma, queda grabada.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      id: uuidv7(),
      tenantId: entry.tenantId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      actorName: entry.actorName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    });
  }
}
