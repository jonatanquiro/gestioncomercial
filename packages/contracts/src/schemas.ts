import { z } from 'zod';
import { isValidCuit, normalizeCuit } from './cuit';
import { PERMISSION_CODES, type PermissionCode } from './permissions';

const trimmed = (max: number) => z.string().trim().min(1, 'Obligatorio').max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Email inválido')).pipe(z.string().max(254));

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña no puede superar 128 caracteres');

export const cuitSchema = z
  .string()
  .trim()
  .transform(normalizeCuit)
  .refine(isValidCuit, 'CUIT inválido');

export const TAX_CONDITIONS = ['responsable_inscripto', 'monotributo', 'exento'] as const;
export const taxConditionSchema = z.enum(TAX_CONDITIONS);
export type TaxCondition = z.infer<typeof taxConditionSchema>;

export const TAX_CONDITION_LABELS: Record<TaxCondition, string> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributista',
  exento: 'Exento',
};

export const uuidSchema = z.uuid('Identificador inválido');

const permissionCodeSchema = z.enum(PERMISSION_CODES as [PermissionCode, ...PermissionCode[]]);

// ---------- Autenticación ----------

export const registerTenantSchema = z.object({
  tradeName: trimmed(120),
  legalName: optionalText(160),
  cuit: cuitSchema.optional().nullable().or(z.literal('').transform(() => null)),
  taxCondition: taxConditionSchema,
  businessTypeCode: trimmed(40),
  ownerName: trimmed(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Obligatorio').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const switchTenantSchema = z.object({ tenantId: uuidSchema });

// ---------- Comercio ----------

export const tenantSettingsSchema = z.object({
  allowNegativeStock: z.boolean(),
  priceRoundingStep: z.union([z.literal(0), z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const updateTenantSchema = z.object({
  tradeName: trimmed(120),
  legalName: optionalText(160),
  cuit: cuitSchema.optional().nullable().or(z.literal('').transform(() => null)),
  taxCondition: taxConditionSchema,
  address: optionalText(200),
  phone: optionalText(40),
  email: emailSchema.optional().nullable().or(z.literal('').transform(() => null)),
  settings: tenantSettingsSchema,
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const createBranchSchema = z.object({
  name: trimmed(80),
  address: optionalText(200),
});
export const updateBranchSchema = createBranchSchema.extend({
  status: z.enum(['active', 'inactive']),
});

// ---------- Usuarios y roles ----------

export const createEmployeeSchema = z.object({
  name: trimmed(120),
  email: emailSchema,
  password: passwordSchema,
  roleId: uuidSchema,
  branchIds: z.array(uuidSchema).min(1, 'Elegí al menos una sucursal').max(100),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateMembershipSchema = z.object({
  roleId: uuidSchema,
  branchIds: z.array(uuidSchema).min(1, 'Elegí al menos una sucursal').max(100),
  status: z.enum(['active', 'inactive']),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const roleSchema = z.object({
  name: trimmed(60),
  permissions: z.array(permissionCodeSchema).max(200),
});
export type RoleInput = z.infer<typeof roleSchema>;

// ---------- Plataforma ----------

export const platformLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totp: z.string().trim().regex(/^\d{6}$/, 'Código de 6 dígitos'),
});

export const setTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: trimmed(300),
});

/** Alta manual de un comercio desde la plataforma. El dueño recibe una invitación para elegir su contraseña. */
export const platformCreateTenantSchema = z.object({
  tradeName: trimmed(120),
  legalName: optionalText(160),
  cuit: cuitSchema.optional().nullable().or(z.literal('').transform(() => null)),
  taxCondition: taxConditionSchema,
  businessTypeCode: trimmed(40),
  planCode: trimmed(40),
  ownerName: trimmed(120),
  ownerEmail: emailSchema,
});
export type PlatformCreateTenantInput = z.infer<typeof platformCreateTenantSchema>;

export const PLAN_LIMIT_KEYS = ['max_branches', 'max_users', 'max_products', 'max_registers'] as const;
export const PLAN_FEATURES = ['multi_branch', 'fiscal_arca', 'advanced_reports', 'offline_pos', 'promotions', 'variants'] as const;

export const updatePlanSchema = z.object({
  name: trimmed(60),
  price: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Importe inválido'),
  trialDays: z.number().int().min(0).max(365),
  active: z.boolean(),
  limits: z.record(z.enum(PLAN_LIMIT_KEYS), z.number().int().min(0).max(100000)),
  features: z.array(z.enum(PLAN_FEATURES)).max(20),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});
