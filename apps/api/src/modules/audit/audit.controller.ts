import { Controller, Get, Query } from '@nestjs/common';
import { type AuditEntryDto, listQuerySchema, type Paginated } from '@gc/contracts';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type TenantActor, scopeOf } from '../../common/actor';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DbService } from '../../db/db.service';
import { auditLog } from '../../db/schema';

const auditQuery = listQuerySchema.extend({ entityType: z.string().trim().max(40).optional() });

@Controller('audit')
export class AuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@CurrentActor() actor: TenantActor, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>): Promise<Paginated<AuditEntryDto>> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const conditions: SQL[] = [eq(auditLog.tenantId, actor.tenantId)];
      if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
      const where = and(...conditions);
      const [total] = await tx.select({ n: count() }).from(auditLog).where(where);
      const rows = await tx
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: rows.map((r) => ({
          id: r.id,
          at: r.at.toISOString(),
          actorName: r.actorName,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: r.before,
          after: r.after,
          ip: r.ip,
        })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
}
