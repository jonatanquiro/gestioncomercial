import { Injectable } from '@nestjs/common';
import type { TenantDto, UpdateTenantInput } from '@gc/contracts';
import { and, count, eq, sql } from 'drizzle-orm';
import { type TenantActor, scopeOf } from '../../common/actor';
import { Errors } from '../../common/errors';
import { DbService, type Tx } from '../../db/db.service';
import { branches, memberships, tenants } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from './entitlements.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  get(actor: TenantActor): Promise<TenantDto> {
    return this.db.tenant(scopeOf(actor), (tx) => this.load(tx, actor.tenantId));
  }

  update(actor: TenantActor, input: UpdateTenantInput): Promise<TenantDto> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const [before] = await tx.select().from(tenants).where(eq(tenants.id, actor.tenantId)).for('update');
      if (!before) throw Errors.notFound('Comercio');
      const after = {
        tradeName: input.tradeName,
        legalName: input.legalName,
        cuit: input.cuit ?? null,
        taxCondition: input.taxCondition,
        address: input.address,
        phone: input.phone,
        email: input.email ?? null,
        settings: input.settings,
      };
      await tx
        .update(tenants)
        .set({ ...after, version: sql`${tenants.version} + 1`, updatedAt: sql`now()` })
        .where(eq(tenants.id, actor.tenantId));
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'tenant.updated',
        entityType: 'tenant',
        entityId: actor.tenantId,
        before: {
          tradeName: before.tradeName,
          legalName: before.legalName,
          cuit: before.cuit,
          taxCondition: before.taxCondition,
          address: before.address,
          phone: before.phone,
          email: before.email,
          settings: before.settings,
        },
        after,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return this.load(tx, actor.tenantId);
    });
  }

  private async load(tx: Tx, tenantId: string): Promise<TenantDto> {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw Errors.notFound('Comercio');
    const [b] = await tx.select({ n: count() }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.status, 'active')));
    const [u] = await tx
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, 'active')));
    return {
      id: t.id,
      tradeName: t.tradeName,
      legalName: t.legalName,
      cuit: t.cuit,
      taxCondition: t.taxCondition as TenantDto['taxCondition'],
      address: t.address,
      phone: t.phone,
      email: t.email,
      businessTypeCode: t.businessTypeCode,
      status: t.status,
      settings: t.settings,
      plan: await this.entitlements.plan(tx, tenantId),
      usage: { branches: b?.n ?? 0, users: u?.n ?? 0 },
    };
  }
}
