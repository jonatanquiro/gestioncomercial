import type { PermissionCode } from '@gc/contracts';

/** Usuario autenticado de un comercio, resuelto en cada request desde la sesión. */
export interface Actor {
  userId: string;
  userName: string;
  sessionId: string;
  tenantId: string | null;
  tenantStatus: string | null;
  membershipId: string | null;
  roleId: string | null;
  permissions: ReadonlySet<PermissionCode>;
  branchIds: string[];
  ip: string;
  requestId: string;
}

/** Actor con comercio activo (lo garantiza el guard salvo en rutas @AllowNoTenant). */
export interface TenantActor extends Actor {
  tenantId: string;
  membershipId: string;
  roleId: string;
}

export interface PlatformActor {
  platformUserId: string;
  name: string;
  sessionId: string;
  ip: string;
  requestId: string;
}

export function scopeOf(actor: TenantActor) {
  return { tenantId: actor.tenantId, userId: actor.userId };
}
