import { Injectable } from '@nestjs/common';
import type { BranchDto } from '@gc/contracts';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { type TenantActor, scopeOf } from '../../common/actor';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { DbService } from '../../db/db.service';
import { branches, warehouses } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../tenants/entitlements.service';

type BranchRow = typeof branches.$inferSelect;
const toDto = (b: BranchRow): BranchDto => ({
  id: b.id,
  name: b.name,
  address: b.address,
  status: b.status as BranchDto['status'],
  createdAt: b.createdAt.toISOString(),
});

@Injectable()
export class BranchesService {
  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  list(actor: TenantActor): Promise<BranchDto[]> {
    return this.db.tenant(scopeOf(actor), async (tx) =>
      (await tx.select().from(branches).orderBy(asc(branches.createdAt))).map(toDto),
    );
  }

  create(actor: TenantActor, input: { name: string; address: string | null }): Promise<BranchDto> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      await this.entitlements.lockTenant(tx, actor.tenantId);
      const [active] = await tx.select({ n: count() }).from(branches).where(eq(branches.status, 'active'));
      await this.entitlements.assertBelowLimit(tx, actor.tenantId, 'max_branches', active?.n ?? 0);
      const id = uuidv7();
      const [row] = await tx.insert(branches).values({ id, tenantId: actor.tenantId, name: input.name, address: input.address }).returning();
      await tx.insert(warehouses).values({ id: uuidv7(), tenantId: actor.tenantId, branchId: id, name: 'Depósito principal', isDefault: true });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'branch.created',
        entityType: 'branch',
        entityId: id,
        after: input,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return toDto(row!);
    });
  }

  update(actor: TenantActor, id: string, input: { name: string; address: string | null; status: 'active' | 'inactive' }) {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      await this.entitlements.lockTenant(tx, actor.tenantId);
      const [before] = await tx.select().from(branches).where(eq(branches.id, id)).for('update');
      if (!before) throw Errors.notFound('Sucursal');
      if (before.status === 'active' && input.status === 'inactive') {
        const [active] = await tx.select({ n: count() }).from(branches).where(eq(branches.status, 'active'));
        if ((active?.n ?? 0) <= 1) throw Errors.conflict('LAST_BRANCH', 'El comercio debe tener al menos una sucursal activa');
      }
      if (before.status === 'inactive' && input.status === 'active') {
        const [active] = await tx.select({ n: count() }).from(branches).where(eq(branches.status, 'active'));
        await this.entitlements.assertBelowLimit(tx, actor.tenantId, 'max_branches', active?.n ?? 0);
      }
      const [row] = await tx
        .update(branches)
        .set({ ...input, updatedAt: sql`now()` })
        .where(and(eq(branches.id, id)))
        .returning();
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'branch.updated',
        entityType: 'branch',
        entityId: id,
        before: { name: before.name, address: before.address, status: before.status },
        after: input,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return toDto(row!);
    });
  }
}
