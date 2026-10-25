import { Injectable } from '@nestjs/common';
import type { MeResponse, PermissionCode, RegisterTenantInput } from '@gc/contracts';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import type { ClientInfoValue } from '../../common/decorators';
import { hashToken, randomToken } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { RateLimiter } from '../../common/rate-limiter';
import { loadEnv } from '../../config/env';
import { DbService, enterAuth, enterTenant } from '../../db/db.service';
import { memberships, passwordResetTokens, roles, tenants, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../mail/mailer.service';
import { TenantProvisioningService } from '../tenants/provisioning.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const MIN = 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * MIN;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly provisioning: TenantProvisioningService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Registro de un comercio nuevo con su propietario, todo en una transacción. */
  async register(input: RegisterTenantInput, client: ClientInfoValue) {
    this.limiter.consume(`register:${client.ip}`, 10, 60 * MIN);
    const passwordHash = await this.passwords.hash(input.password);
    const userId = uuidv7();
    const tenantId = uuidv7();

    return this.db.auth(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
      if (existing) throw Errors.conflict('EMAIL_IN_USE', 'Ese email ya está registrado. Iniciá sesión o recuperá tu contraseña.');
      await tx.insert(users).values({ id: userId, email: input.email, name: input.ownerName, passwordHash });

      await enterTenant(tx, { tenantId, userId });
      await this.provisioning.create(tx, {
        tenantId,
        ownerUserId: userId,
        ownerName: input.ownerName,
        input,
        ip: client.ip,
        requestId: client.requestId,
      });

      await enterAuth(tx);
      return this.sessions.create(tx, { userId, tenantId, ip: client.ip, userAgent: client.userAgent });
    });
  }

  async login(email: string, password: string, client: ClientInfoValue) {
    const key = `login:${client.ip}:${email}`;
    this.limiter.consume(key, 10, 15 * MIN);
    this.limiter.consume(`login-ip:${client.ip}`, 50, 15 * MIN);

    const user = await this.db.auth(async (tx) => {
      const [u] = await tx
        .select({ id: users.id, name: users.name, passwordHash: users.passwordHash, status: users.status })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      return u ?? null;
    });

    const ok = await this.passwords.verify(user?.status === 'active' ? user.passwordHash : null, password);
    if (!user || !ok) {
      await this.db.auth((tx) =>
        this.audit.record(tx, {
          tenantId: null,
          actorType: 'user',
          actorId: user?.id ?? null,
          actorName: null,
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user?.id ?? null,
          after: { email },
          ip: client.ip,
          requestId: client.requestId,
        }),
      );
      throw Errors.invalidCredentials();
    }
    this.limiter.reset(key);

    const tenantId = await this.defaultTenant(user.id);
    return this.db.auth(async (tx) => {
      const session = await this.sessions.create(tx, { userId: user.id, tenantId, ip: client.ip, userAgent: client.userAgent });
      if (tenantId) {
        await enterTenant(tx, { tenantId, userId: user.id });
        await this.audit.record(tx, {
          tenantId,
          actorType: 'user',
          actorId: user.id,
          actorName: user.name,
          action: 'auth.login',
          entityType: 'session',
          entityId: session.id,
          ip: client.ip,
          requestId: client.requestId,
        });
      }
      return session;
    });
  }

  async logout(actor: Actor) {
    await this.db.auth((tx) => this.sessions.revoke(tx, actor.sessionId, actor.userId));
  }

  /** Siempre responde igual, exista o no el email, para no revelar cuentas. */
  async forgotPassword(email: string, client: ClientInfoValue) {
    this.limiter.consume(`forgot-ip:${client.ip}`, 5, 15 * MIN);
    try {
      this.limiter.consume(`forgot:${email}`, 3, 60 * MIN);
    } catch {
      return;
    }
    const token = randomToken();
    const user = await this.db.auth(async (tx) => {
      const [u] = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email}`, eq(users.status, 'active')))
        .limit(1);
      if (!u) return null;
      await tx.insert(passwordResetTokens).values({
        id: uuidv7(),
        userId: u.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });
      return u;
    });
    if (!user) return;
    const link = `${loadEnv().APP_URL}/restablecer?token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Restablecer tu contraseña',
      text: `Hola ${user.name}:\n\nPara elegir una contraseña nueva, entrá a este enlace (vence en 30 minutos):\n${link}\n\nSi no lo pediste, ignorá este correo.`,
    });
  }

  async resetPassword(token: string, password: string, client: ClientInfoValue) {
    this.limiter.consume(`reset-ip:${client.ip}`, 10, 15 * MIN);
    const passwordHash = await this.passwords.hash(password);
    await this.db.auth(async (tx) => {
      const [row] = await tx
        .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
        .from(passwordResetTokens)
        .innerJoin(users, eq(users.id, passwordResetTokens.userId))
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, sql`now()`),
            eq(users.status, 'active'),
          ),
        )
        .for('update')
        .limit(1);
      if (!row) throw Errors.badRequest('RESET_TOKEN_INVALID', 'El enlace venció o ya fue usado. Pedí uno nuevo.');
      await tx.update(passwordResetTokens).set({ usedAt: sql`now()` }).where(eq(passwordResetTokens.id, row.id));
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(users.id, row.userId));
      await this.sessions.revokeAll(tx, row.userId);
      await this.audit.record(tx, {
        tenantId: null,
        actorType: 'user',
        actorId: row.userId,
        actorName: null,
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: row.userId,
        ip: client.ip,
        requestId: client.requestId,
      });
    });
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    this.limiter.consume(`change-pw:${actor.userId}`, 10, 15 * MIN);
    const current = await this.db.auth(async (tx) => {
      const [u] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, actor.userId));
      return u?.hash ?? null;
    });
    if (!(await this.passwords.verify(current, currentPassword))) {
      throw Errors.badRequest('INVALID_PASSWORD', 'La contraseña actual no es correcta');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.auth(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(users.id, actor.userId));
      await this.sessions.revokeAll(tx, actor.userId, actor.sessionId);
      await this.audit.record(tx, {
        tenantId: null,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: actor.userId,
        ip: actor.ip,
        requestId: actor.requestId,
      });
    });
  }

  async switchTenant(actor: Actor, tenantId: string) {
    const allowed = await this.db.user(actor.userId, async (tx) => {
      const [m] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(
          and(
            eq(memberships.userId, actor.userId),
            eq(memberships.tenantId, tenantId),
            eq(memberships.status, 'active'),
            ne(tenants.status, 'cancelled'),
          ),
        );
      return Boolean(m);
    });
    if (!allowed) throw Errors.notFound('Comercio');
    await this.db.auth(async (tx) => {
      await this.sessions.setTenant(tx, actor.sessionId, tenantId);
      await enterTenant(tx, { tenantId, userId: actor.userId });
      await this.audit.record(tx, {
        tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'auth.tenant_selected',
        entityType: 'session',
        entityId: actor.sessionId,
        ip: actor.ip,
        requestId: actor.requestId,
      });
    });
  }

  async me(actor: Actor): Promise<MeResponse> {
    return this.db.user(actor.userId, async (tx) => {
      const [user] = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, actor.userId));
      const list = await tx
        .select({
          tenantId: memberships.tenantId,
          tenantName: tenants.tradeName,
          tenantStatus: tenants.status,
          businessTypeCode: tenants.businessTypeCode,
          roleId: roles.id,
          roleName: roles.name,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.userId, actor.userId), ne(tenants.status, 'cancelled')))
        .orderBy(asc(tenants.tradeName));
      const current = list.find((m) => m.tenantId === actor.tenantId && m.status === 'active');
      return {
        user: user!,
        tenant: current
          ? { id: current.tenantId, tradeName: current.tenantName, status: current.tenantStatus, businessTypeCode: current.businessTypeCode }
          : null,
        role: current ? { id: current.roleId, name: current.roleName } : null,
        permissions: current ? ([...actor.permissions] as PermissionCode[]).sort() : [],
        branchIds: current ? actor.branchIds : [],
        memberships: list.map((m) => ({
          tenantId: m.tenantId,
          tenantName: m.tenantName,
          roleName: m.roleName,
          status: m.status as 'active' | 'inactive',
          tenantStatus: m.tenantStatus,
        })),
      };
    });
  }

  async listSessions(actor: Actor) {
    const rows = await this.db.auth((tx) => this.sessions.listActive(tx, actor.userId));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      ip: r.ip,
      userAgent: r.userAgent,
      current: r.id === actor.sessionId,
    }));
  }

  async revokeSession(actor: Actor, sessionId: string) {
    const ok = await this.db.auth((tx) => this.sessions.revoke(tx, sessionId, actor.userId));
    if (!ok) throw Errors.notFound('Sesión');
  }

  private async defaultTenant(userId: string): Promise<string | null> {
    return this.db.user(userId, async (tx) => {
      const [m] = await tx
        .select({ tenantId: memberships.tenantId })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), ne(tenants.status, 'cancelled')))
        .orderBy(asc(memberships.createdAt))
        .limit(1);
      return m?.tenantId ?? null;
    });
  }
}
