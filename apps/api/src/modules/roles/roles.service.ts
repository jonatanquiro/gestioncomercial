import { Injectable } from '@nestjs/common';
import { isPermissionCode, type PermissionCode, type RoleDto, type RoleInput } from '@gc/contracts';
import { asc, count, eq, sql } from 'drizzle-orm';
import { type TenantActor, scopeOf } from '../../common/actor';
import { Errors } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { DbService, type Tx } from '../../db/db.service';
import { memberships, rolePermissions, roles } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** Nadie puede otorgar permisos que no tiene (evita escalar privilegios). */
export function assertCanGrant(actor: TenantActor, permissions: Iterable<PermissionCode>) {
  const missing = [...permissions].filter((p) => !actor.permissions.has(p));
  if (missing.length > 0) {
    throw Errors.badRequest('CANNOT_GRANT', `No podés otorgar permisos que no tenés: ${missing.join(', ')}`);
  }
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(actor: TenantActor): Promise<RoleDto[]> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const rows = await tx.select().from(roles).orderBy(asc(roles.createdAt));
      const perms = await tx.select().from(rolePermissions);
      const members = await tx
        .select({ roleId: memberships.roleId, n: count() })
        .from(memberships)
        .where(eq(memberships.status, 'active'))
        .groupBy(memberships.roleId);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        isSystem: r.isSystem,
        templateCode: r.templateCode,
        permissions: perms
          .filter((p) => p.roleId === r.id)
          .map((p) => p.permissionCode)
          .filter(isPermissionCode)
          .sort(),
        memberCount: members.find((m) => m.roleId === r.id)?.n ?? 0,
      }));
    });
  }

  create(actor: TenantActor, input: RoleInput): Promise<{ id: string }> {
    assertCanGrant(actor, input.permissions);
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const id = uuidv7();
      await tx.insert(roles).values({ id, tenantId: actor.tenantId, name: input.name });
      await this.setPermissions(tx, actor.tenantId, id, input.permissions);
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'role.created',
        entityType: 'role',
        entityId: id,
        after: input,
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return { id };
    });
  }

  update(actor: TenantActor, id: string, input: RoleInput): Promise<{ id: string }> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for('update');
      if (!role) throw Errors.notFound('Rol');
      if (role.isSystem) throw Errors.conflict('SYSTEM_ROLE', 'El rol Propietario no se puede modificar');
      const before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, id))).map((p) => p.permissionCode);
      // Solo se exige tener los permisos que cambian (agregados o quitados).
      const changed = [
        ...input.permissions.filter((p) => !before.includes(p)),
        ...before.filter(isPermissionCode).filter((p) => !input.permissions.includes(p)),
      ];
      assertCanGrant(actor, changed);
      await tx.update(roles).set({ name: input.name, updatedAt: sql`now()` }).where(eq(roles.id, id));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await this.setPermissions(tx, actor.tenantId, id, input.permissions);
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'role.updated',
        entityType: 'role',
        entityId: id,
        before: { name: role.name, permissions: before.sort() },
        after: { name: input.name, permissions: [...input.permissions].sort() },
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return { id };
    });
  }

  remove(actor: TenantActor, id: string): Promise<void> {
    return this.db.tenant(scopeOf(actor), async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for('update');
      if (!role) throw Errors.notFound('Rol');
      if (role.isSystem) throw Errors.conflict('SYSTEM_ROLE', 'El rol Propietario no se puede eliminar');
      const [used] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.roleId, id));
      if ((used?.n ?? 0) > 0) {
        throw Errors.conflict('ROLE_IN_USE', 'El rol tiene empleados asignados (activos o inactivos). Reasignalos antes de eliminarlo.');
      }
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorType: 'user',
        actorId: actor.userId,
        actorName: actor.userName,
        action: 'role.deleted',
        entityType: 'role',
        entityId: id,
        before: { name: role.name },
        ip: actor.ip,
        requestId: actor.requestId,
      });
    });
  }

  private async setPermissions(tx: Tx, tenantId: string, roleId: string, permissions: PermissionCode[]) {
    const unique = [...new Set(permissions)];
    if (unique.length === 0) return;
    await tx.insert(rolePermissions).values(unique.map((permissionCode) => ({ tenantId, roleId, permissionCode })));
  }
}
