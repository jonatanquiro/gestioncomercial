import { Injectable } from '@nestjs/common';
import type { Paginated, PlanDto, PlatformTenantDto, UpdatePlanInput } from '@gc/contracts';
import { and, asc, count, desc, eq, ilike, ne, or, type SQL, sql } from 'drizzle-orm';
import { authenticator } from 'otplib';
import type { PlatformActor } from '../../common/actor';
import { decryptSecret } from '../../common/crypto';
import type { ClientInfoValue } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { RateLimiter } from '../../common/rate-limiter';
import { DbService, type Tx } from '../../db/db.service';
import { auditLog, planFeatures, planLimits, plans, platformUsers, subscriptions, tenants } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { PlatformSessionService } from '../auth/platform-session.service';

const MIN = 60 * 1000;

@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly sessions: PlatformSessionService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Login con contraseña y TOTP obligatorio. */
  async login(input: { email: string; password: string; totp: string }, client: ClientInfoValue): Promise<string> {
    this.limiter.consume(`platform-login:${client.ip}`, 10, 15 * MIN);
    const user = await this.db.platform(async (tx) => {
      const [u] = await tx
        .select()
        .from(platformUsers)
        .where(and(sql`lower(${platformUsers.email}) = ${input.email}`, eq(platformUsers.status, 'active')))
        .limit(1);
      return u ?? null;
    });
    const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    const totpOk = user ? authenticator.verify({ token: input.totp, secret: decryptSecret(user.totpSecretEnc) }) : false;
    if (!user || !passwordOk || !totpOk) {
      await this.db.platform((tx) =>
        this.audit.record(tx, {
          tenantId: null,
          actorType: 'platform',
          actorId: user?.id ?? null,
          actorName: null,
          action: 'platform.login_failed',
          entityType: 'platform_user',
          entityId: user?.id ?? null,
          after: { email: input.email },
          ip: client.ip,
          requestId: client.requestId,
        }),
      );
      throw Errors.invalidCredentials();
    }
    return this.db.platform(async (tx) => {
      const token = await this.sessions.create(tx, { platformUserId: user.id, ip: client.ip, userAgent: client.userAgent });
      await this.audit.record(tx, {
        tenantId: null,
        actorType: 'platform',
        actorId: user.id,
        actorName: user.name,
        action: 'platform.login',
        entityType: 'platform_user',
        entityId: user.id,
        ip: client.ip,
        requestId: client.requestId,
      });
      return token;
    });
  }

  logout(actor: PlatformActor) {
    return this.db.platform((tx) => this.sessions.revoke(tx, actor.sessionId));
  }

  async listTenants(q: { page: number; pageSize: number; q?: string; status?: string }): Promise<Paginated<PlatformTenantDto>> {
    return this.db.platform(async (tx) => {
      const conditions: SQL[] = [];
      if (q.q) {
        const term = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        conditions.push(or(ilike(tenants.tradeName, term), ilike(tenants.cuit, term))!);
      }
      if (q.status) conditions.push(eq(tenants.status, q.status));
      const where = conditions.length ? and(...conditions) : undefined;
      const [total] = await tx.select({ n: count() }).from(tenants).where(where);
      const rows = await tx
        .select({
          id: tenants.id,
          tradeName: tenants.tradeName,
          cuit: tenants.cuit,
          businessTypeCode: tenants.businessTypeCode,
          status: tenants.status,
          createdAt: tenants.createdAt,
          planCode: plans.code,
          subscriptionStatus: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
        })
        .from(tenants)
        .leftJoin(subscriptions, and(eq(subscriptions.tenantId, tenants.id), ne(subscriptions.status, 'cancelled')))
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(where)
        .orderBy(desc(tenants.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const usage = await tx.execute<{ tenant_id: string; user_count: string; branch_count: string }>(
        sql`SELECT tenant_id, user_count, branch_count FROM platform_tenant_usage()`,
      );
      const byTenant = new Map(usage.rows.map((u) => [u.tenant_id, u]));
      return {
        items: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
          userCount: Number(byTenant.get(r.id)?.user_count ?? 0),
          branchCount: Number(byTenant.get(r.id)?.branch_count ?? 0),
        })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  setTenantStatus(actor: PlatformActor, tenantId: string, input: { status: 'active' | 'suspended'; reason: string }) {
    return this.db.platform(async (tx) => {
      const [t] = await tx.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)).for('update');
      if (!t) throw Errors.notFound('Comercio');
      if (t.status === 'cancelled') throw Errors.conflict('TENANT_CANCELLED', 'El comercio está dado de baja');
      await tx.update(tenants).set({ status: input.status, updatedAt: sql`now()` }).where(eq(tenants.id, tenantId));
      await this.audit.record(tx, {
        tenantId,
        actorType: 'platform',
        actorId: actor.platformUserId,
        actorName: `Plataforma: ${actor.name}`,
        action: input.status === 'suspended' ? 'platform.tenant_suspended' : 'platform.tenant_activated',
        entityType: 'tenant',
        entityId: tenantId,
        before: { status: t.status },
        after: { status: input.status, reason: input.reason },
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return { ok: true };
    });
  }

  listPlans(): Promise<PlanDto[]> {
    return this.db.platform(async (tx) => {
      const rows = await tx.select().from(plans).orderBy(asc(plans.sortOrder));
      return Promise.all(rows.map((p) => this.toPlanDto(tx, p)));
    });
  }

  updatePlan(actor: PlatformActor, planId: string, input: UpdatePlanInput): Promise<PlanDto> {
    return this.db.platform(async (tx) => {
      const [before] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
      if (!before) throw Errors.notFound('Plan');
      const beforeDto = await this.toPlanDto(tx, before);
      const [updated] = await tx
        .update(plans)
        .set({ name: input.name, price: input.price, trialDays: input.trialDays, active: input.active, updatedAt: sql`now()` })
        .where(eq(plans.id, planId))
        .returning();
      await tx.delete(planLimits).where(eq(planLimits.planId, planId));
      const limits = Object.entries(input.limits);
      if (limits.length) await tx.insert(planLimits).values(limits.map(([key, value]) => ({ planId, key, value })));
      await tx.delete(planFeatures).where(eq(planFeatures.planId, planId));
      const features = [...new Set(input.features)];
      if (features.length) await tx.insert(planFeatures).values(features.map((feature) => ({ planId, feature })));
      const after = await this.toPlanDto(tx, updated!);
      await this.audit.record(tx, {
        tenantId: null,
        actorType: 'platform',
        actorId: actor.platformUserId,
        actorName: actor.name,
        action: 'platform.plan_updated',
        entityType: 'plan',
        entityId: planId,
        before: beforeDto,
        after,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return after;
    });
  }

  listAudit(q: { page: number; pageSize: number }) {
    return this.db.platform(async (tx) => {
      const [total] = await tx.select({ n: count() }).from(auditLog);
      const rows = await tx
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
        total: total?.n ?? 0,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  private async toPlanDto(tx: Tx, p: typeof plans.$inferSelect): Promise<PlanDto> {
    const limits = await tx.select().from(planLimits).where(eq(planLimits.planId, p.id));
    const features = await tx.select().from(planFeatures).where(eq(planFeatures.planId, p.id));
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.price,
      currency: p.currency,
      trialDays: p.trialDays,
      active: p.active,
      limits: Object.fromEntries(limits.map((l) => [l.key, l.value])),
      features: features.map((f) => f.feature).sort(),
    };
  }
}
