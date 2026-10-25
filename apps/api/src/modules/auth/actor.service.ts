import { Injectable } from '@nestjs/common';
import { isPermissionCode, type PermissionCode } from '@gc/contracts';
import { and, eq } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { DbService, type Tx } from '../../db/db.service';
import { membershipBranches, memberships, rolePermissions, tenants } from '../../db/schema';
import type { ValidSession } from './session.service';

export interface MembershipContext {
  tenantStatus: string;
  membershipId: string;
  roleId: string;
  permissions: Set<PermissionCode>;
  branchIds: string[];
}

/** Arma el contexto de permisos del usuario en su comercio activo. */
@Injectable()
export class ActorService {
  constructor(private readonly db: DbService) {}

  async resolve(session: ValidSession, client: { ip: string; requestId: string }): Promise<Actor> {
    const context = session.tenantId
      ? await this.db.tenant({ tenantId: session.tenantId, userId: session.userId }, (tx) =>
          loadMembershipContext(tx, session.tenantId!, session.userId),
        )
      : null;
    return {
      userId: session.userId,
      userName: session.userName,
      sessionId: session.sessionId,
      tenantId: context ? session.tenantId : null,
      tenantStatus: context?.tenantStatus ?? null,
      membershipId: context?.membershipId ?? null,
      roleId: context?.roleId ?? null,
      permissions: context?.permissions ?? new Set(),
      branchIds: context?.branchIds ?? [],
      ip: client.ip,
      requestId: client.requestId,
    };
  }
}

/** Debe llamarse dentro de una transacción con contexto de ese comercio y usuario. */
export async function loadMembershipContext(tx: Tx, tenantId: string, userId: string): Promise<MembershipContext | null> {
  const [m] = await tx
    .select({ membershipId: memberships.id, roleId: memberships.roleId, tenantStatus: tenants.status })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, 'active')))
    .limit(1);
  if (!m) return null;
  const perms = await tx
    .select({ code: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, m.roleId));
  const branches = await tx
    .select({ branchId: membershipBranches.branchId })
    .from(membershipBranches)
    .where(eq(membershipBranches.membershipId, m.membershipId));
  return {
    tenantStatus: m.tenantStatus,
    membershipId: m.membershipId,
    roleId: m.roleId,
    permissions: new Set(perms.map((p) => p.code).filter(isPermissionCode)),
    branchIds: branches.map((b) => b.branchId),
  };
}
