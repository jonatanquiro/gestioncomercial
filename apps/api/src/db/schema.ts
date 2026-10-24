import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { TenantSettings } from '@gc/contracts';

/*
 * Convenciones (sección 4 del diseño):
 * - PK uuid v7 generada por la aplicación.
 * - Toda tabla comercial tiene tenant_id y UNIQUE (tenant_id, id); los hijos
 *   referencian (tenant_id, padre_id) para que la base impida cruces entre comercios.
 * - RLS, roles de base y triggers append-only se definen en migraciones SQL propias.
 */

const id = () => uuid('id').primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- Catálogos globales

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  module: text('module').notNull(),
  label: text('label').notNull(),
});

export const businessTypes = pgTable('business_types', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  defaultSettings: jsonb('default_settings').notNull(),
  defaultCategories: jsonb('default_categories').$type<string[]>().notNull(),
  recommendedFeatures: jsonb('recommended_features').$type<string[]>().notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const plans = pgTable('plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('ARS'),
  trialDays: integer('trial_days').notNull().default(14),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const planLimits = pgTable(
  'plan_limits',
  {
    planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: integer('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.key] })],
);

export const planFeatures = pgTable(
  'plan_features',
  {
    planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.feature] })],
);

// ---------------------------------------------------------------- Plataforma

export const platformUsers = pgTable(
  'platform_users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    totpSecretEnc: text('totp_secret_enc').notNull(),
    role: text('role').notNull().default('admin'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('platform_users_email_uq').on(sql`lower(${t.email})`)],
);

export const platformSessions = pgTable(
  'platform_sessions',
  {
    id: id(),
    platformUserId: uuid('platform_user_id').notNull().references(() => platformUsers.id),
    tokenHash: text('token_hash').notNull().unique(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
);

// ---------------------------------------------------------------- Identidad

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    check('users_status_ck', sql`${t.status} in ('active', 'disabled')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tenantId: uuid('tenant_id'),
    tokenHash: text('token_hash').notNull().unique(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Comercio

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    tradeName: text('trade_name').notNull(),
    legalName: text('legal_name'),
    cuit: text('cuit'),
    taxCondition: text('tax_condition').notNull(),
    businessTypeCode: text('business_type_code').notNull().references(() => businessTypes.code),
    status: text('status').notNull().default('trial'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    settings: jsonb('settings').$type<TenantSettings>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_status_ck', sql`${t.status} in ('trial', 'active', 'past_due', 'suspended', 'cancelled')`),
    check('tenants_tax_condition_ck', sql`${t.taxCondition} in ('responsable_inscripto', 'monotributo', 'exento')`),
    uniqueIndex('tenants_cuit_active_uq').on(t.cuit).where(sql`${t.cuit} is not null and ${t.status} <> 'cancelled'`),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    planId: uuid('plan_id').notNull().references(() => plans.id),
    status: text('status').notNull(),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('subscriptions_status_ck', sql`${t.status} in ('trialing', 'active', 'past_due', 'cancelled')`),
    uniqueIndex('subscriptions_one_current_uq').on(t.tenantId).where(sql`${t.status} <> 'cancelled'`),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    address: text('address'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('branches_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('branches_tenant_name_uq').on(t.tenantId, sql`lower(${t.name})`),
    check('branches_status_ck', sql`${t.status} in ('active', 'inactive')`),
  ],
);

export const warehouses = pgTable(
  'warehouses',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('warehouses_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id], name: 'warehouses_branch_fk' }),
    uniqueIndex('warehouses_one_default_uq').on(t.branchId).where(sql`${t.isDefault}`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    templateCode: text('template_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('roles_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('roles_tenant_name_uq').on(t.tenantId, sql`lower(${t.name})`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: uuid('tenant_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permissionCode: text('permission_code').notNull().references(() => permissions.code),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionCode] }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id], name: 'role_permissions_role_fk' }).onDelete('cascade'),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    roleId: uuid('role_id').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('memberships_tenant_id_uq').on(t.tenantId, t.id),
    unique('memberships_tenant_user_uq').on(t.tenantId, t.userId),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id], name: 'memberships_role_fk' }),
    check('memberships_status_ck', sql`${t.status} in ('active', 'inactive')`),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const membershipBranches = pgTable(
  'membership_branches',
  {
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    branchId: uuid('branch_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.branchId] }),
    foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id], name: 'membership_branches_membership_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id], name: 'membership_branches_branch_fk' }),
  ],
);

// ---------------------------------------------------------------- Auditoría

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    requestId: text('request_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_tenant_at_idx').on(t.tenantId, t.at),
    index('audit_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.at),
    check('audit_actor_type_ck', sql`${t.actorType} in ('user', 'platform', 'system')`),
  ],
);
