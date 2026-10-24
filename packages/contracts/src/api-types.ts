import type { PermissionCode } from './permissions';
import type { TaxCondition, TenantSettings } from './schemas';

/** Formato único de error de la API. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  roleName: string;
  status: 'active' | 'inactive';
  tenantStatus: string;
}

export interface MeResponse {
  user: { id: string; name: string; email: string };
  tenant: { id: string; tradeName: string; status: string; businessTypeCode: string } | null;
  role: { id: string; name: string } | null;
  permissions: PermissionCode[];
  branchIds: string[];
  memberships: MembershipSummary[];
}

export interface TenantDto {
  id: string;
  tradeName: string;
  legalName: string | null;
  cuit: string | null;
  taxCondition: TaxCondition;
  address: string | null;
  phone: string | null;
  email: string | null;
  businessTypeCode: string;
  status: string;
  settings: TenantSettings;
  plan: { code: string; name: string; limits: Record<string, number>; features: string[] } | null;
  usage: { branches: number; users: number };
}

export interface BranchDto {
  id: string;
  name: string;
  address: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface RoleDto {
  id: string;
  name: string;
  isSystem: boolean;
  templateCode: string | null;
  permissions: PermissionCode[];
  memberCount: number;
}

export interface EmployeeDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  status: 'active' | 'inactive';
  branchIds: string[];
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

export interface BusinessTypeDto {
  code: string;
  name: string;
}

export interface SessionDto {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface PlatformTenantDto {
  id: string;
  tradeName: string;
  cuit: string | null;
  businessTypeCode: string;
  status: string;
  planCode: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  userCount: number;
  branchCount: number;
}

export interface PlanDto {
  id: string;
  code: string;
  name: string;
  price: string;
  currency: string;
  trialDays: number;
  active: boolean;
  limits: Record<string, number>;
  features: string[];
}
