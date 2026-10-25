import { Injectable } from '@nestjs/common';
import { type CreateEmployeeInput, type EmployeeDto, isPermissionCode, type UpdateMembershipInput } from '@gc/contracts';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { type TenantActor, scopeOf } from '../../common/actor';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { DbService, enterAuth, enterTenant, type Tx } from '../../db/db.service';
import { membershipBranches, memberships, rolePermissions, roles, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { assertCanGrant } from '../roles/roles.service';
import { EntitlementsService } from '../tenants/entitlements.service';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  list(actor: TenantActor): Promise<EmployeeDto[]> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const rows = await tx
        .select({
          membershipId: memberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          roleId: roles.id,
          roleName: roles.name,
          status: memberships.status,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.tenantId, actor.tenantId))
        .orderBy(asc(users.name));
      const links = await tx.select().from(membershipBranches);
      return rows.map((r) => ({
        ...r,
        status: r.status as EmployeeDto['status'],
        createdAt: r.createdAt.toISOString(),
        branchIds: links.filter((l) => l.membershipId === r.membershipId).map((l) => l.branchId),
      }));
    });
  }

  async create(actor: TenantActor, input: CreateEmployeeInput): Promise<{ membershipId: string; existingUser: boolean }> {
    const passwordHash = await this.passwords.hash(input.password);
    const scope = scopeOf(actor);
    return this.db.tenant(scope, async (tx) => {
      await this.assertCanAssignRole(tx, actor, input.roleId);
      await this.entitlements.lockTenant(tx, actor.tenantId);
      const [active] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.status, 'active'));
      await this.entitlements.assertBelowLimit(tx, actor.tenantId, 'max_users', active?.n ?? 0);

      // La identidad es global: si el email ya existe, se suma al comercio sin tocar su contraseña.
      await enterAuth(tx);
      const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
      const userId = existing?.id ?? uuidv7();
      if (!existing) await tx.insert(users).values({ id: userId, email: input.email, name: input.name, passwordHash });
      await enterTenant(tx, scope);

      const membershipId = uuidv7();
      await tx.insert(memberships).values({ id: membershipId, tenantId: actor.tenantId, userId, roleId: input.roleId });
      await tx
        .insert(membershipBranches)
        .values([...new Set(input.branchIds)].map((branchId) => ({ tenantId: actor.tenantId, membershipId, branchId })));
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'membership.created',
        entityType: 'membership',
        entityId: membershipId,
        after: { name: input.name, email: input.email, roleId: input.roleId, branchIds: input.branchIds, existingUser: Boolean(existing) },
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return { membershipId, existingUser: Boolean(existing) };
    });
  }

  update(actor: TenantActor, membershipId: string, input: UpdateMembershipInput): Promise<{ ok: true }> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      await this.entitlements.lockTenant(tx, actor.tenantId);
      const [target] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for('update');
      if (!target) throw Errors.notFound('Empleado');
      const isSelf = target.userId === actor.userId;

      if (isSelf && input.status === 'inactive') throw Errors.conflict('SELF_DEACTIVATION', 'No podés desactivar tu propio usuario');
      if (isSelf && input.roleId !== target.roleId) throw Errors.conflict('SELF_ROLE_CHANGE', 'No podés cambiar tu propio rol');

      // Para modificar a alguien hay que tener todos los permisos de su rol actual y del nuevo.
      await this.assertCanAssignRole(tx, actor, target.roleId);
      if (input.roleId !== target.roleId) await this.assertCanAssignRole(tx, actor, input.roleId);

      const [currentRole] = await tx.select().from(roles).where(eq(roles.id, target.roleId));
      const losesOwner = currentRole?.isSystem && target.status === 'active' && (input.status === 'inactive' || input.roleId !== target.roleId);
      if (losesOwner) {
        const [others] = await tx
          .select({ n: count() })
          .from(memberships)
          .where(and(eq(memberships.roleId, target.roleId), eq(memberships.status, 'active'), ne(memberships.id, membershipId)));
        if ((others?.n ?? 0) === 0) throw Errors.conflict('LAST_OWNER', 'Debe quedar al menos un propietario activo');
      }

      if (target.status === 'inactive' && input.status === 'active') {
        const [active] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.status, 'active'));
        await this.entitlements.assertBelowLimit(tx, actor.tenantId, 'max_users', active?.n ?? 0);
      }

      const beforeBranches = (await tx.select().from(membershipBranches).where(eq(membershipBranches.membershipId, membershipId))).map(
        (b) => b.branchId,
      );
      await tx
        .update(memberships)
        .set({ roleId: input.roleId, status: input.status, updatedAt: sql`now()` })
        .where(eq(memberships.id, membershipId));
      await tx.delete(membershipBranches).where(eq(membershipBranches.membershipId, membershipId));
      await tx
        .insert(membershipBranches)
        .values([...new Set(input.branchIds)].map((branchId) => ({ tenantId: actor.tenantId, membershipId, branchId })));

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'membership.updated',
        entityType: 'membership',
        entityId: membershipId,
        before: { roleId: target.roleId, status: target.status, branchIds: beforeBranches.sort() },
        after: { roleId: input.roleId, status: input.status, branchIds: [...input.branchIds].sort() },
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return { ok: true as const };
    });
  }

  private async assertCanAssignRole(tx: Tx, actor: TenantActor, roleId: string) {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
    if (!role) throw Errors.notFound('Rol');
    const perms = await tx.select({ code: rolePermissions.permissionCode }).from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    assertCanGrant(actor, perms.map((p) => p.code).filter(isPermissionCode));
  }
}
