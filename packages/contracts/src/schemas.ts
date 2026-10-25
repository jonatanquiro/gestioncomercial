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

// ---------- Catálogo e inventario (Fase 3) ----------

/** Importes y cantidades viajan como texto decimal ("1234.50"), nunca como number. */
export const moneySchema = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Importe inválido');
export const costSchema = z.string().trim().regex(/^\d{1,10}(\.\d{1,4})?$/, 'Costo inválido');
export const quantitySchema = z.string().trim().regex(/^\d{1,11}(\.\d{1,3})?$/, 'Cantidad inválida');
export const signedQuantitySchema = z.string().trim().regex(/^-?\d{1,11}(\.\d{1,3})?$/, 'Cantidad inválida');
export const percentSchema = z.string().trim().regex(/^-?\d{1,4}(\.\d{1,2})?$/, 'Porcentaje inválido');

export const PRODUCT_KINDS = ['good', 'service'] as const;
export const SALE_MODES = ['unit', 'weight', 'length', 'volume'] as const;
export type SaleMode = (typeof SALE_MODES)[number];
export const SALE_MODE_LABELS: Record<SaleMode, string> = { unit: 'Por unidad', weight: 'Por peso (kg)', length: 'Por longitud (m)', volume: 'Por volumen (l)' };
export const SALE_MODE_UNITS: Record<SaleMode, string> = { unit: 'un', weight: 'kg', length: 'm', volume: 'l' };

/** Alícuotas de IVA de ARCA. */
export const VAT_RATES = ['21', '10.5', '27', '5', '2.5', '0', 'exento', 'no_gravado'] as const;
export type VatRate = (typeof VAT_RATES)[number];
export const VAT_RATE_LABELS: Record<VatRate, string> = {
  '21': 'IVA 21%', '10.5': 'IVA 10,5%', '27': 'IVA 27%', '5': 'IVA 5%', '2.5': 'IVA 2,5%', '0': 'IVA 0%', exento: 'Exento', no_gravado: 'No gravado',
};

export const categorySchema = z.object({ name: trimmed(80), status: z.enum(['active', 'inactive']) });
export const brandSchema = z.object({ name: trimmed(80) });

export const barcodeSchema = z.object({
  code: z.string().trim().min(1, 'Obligatorio').max(64).regex(/^[0-9A-Za-z.\-_/]+$/, 'Solo letras, números y . - _ /'),
  quantityFactor: z.string().trim().regex(/^\d{1,11}(\.\d{1,3})?$/, 'Cantidad inválida').refine((v) => Number(v) > 0, 'Debe ser mayor a cero'),
});

const productBase = {
  kind: z.enum(PRODUCT_KINDS),
  name: trimmed(160),
  description: optionalText(500),
  categoryId: uuidSchema.nullable(),
  brandId: uuidSchema.nullable(),
  saleMode: z.enum(SALE_MODES),
  vatRate: z.enum(VAT_RATES),
  trackStock: z.boolean(),
  minStock: quantitySchema.nullable(),
  blockNegativeStock: z.boolean(),
  sku: optionalText(60),
  price: moneySchema,
  cost: costSchema.nullable(),
  barcodes: z
    .array(barcodeSchema)
    .max(20)
    .superRefine((list, ctx) => {
      const seen = new Set<string>();
      list.forEach((b, i) => {
        if (seen.has(b.code)) ctx.addIssue({ code: 'custom', path: [i, 'code'], message: 'Código repetido' });
        seen.add(b.code);
      });
    }),
};

export const createProductSchema = z.object({
  ...productBase,
  /** Stock inicial en el depósito principal (necesita el permiso de ajustar stock). */
  initialStock: quantitySchema.nullable(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({ ...productBase, version: z.number().int().min(1) });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });

const stockOperationBase = {
  /** Identificador generado por el navegador: un reintento con el mismo valor no duplica el movimiento. */
  clientUuid: uuidSchema,
  warehouseId: uuidSchema,
  reason: trimmed(200),
};

export const stockAdjustmentSchema = z.object({
  ...stockOperationBase,
  lines: z
    .array(z.object({ variantId: uuidSchema, mode: z.enum(['delta', 'set']), quantity: signedQuantitySchema }))
    .min(1, 'Agregá al menos un artículo')
    .max(200),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const stockWasteSchema = z.object({
  ...stockOperationBase,
  type: z.enum(['waste', 'expired']),
  lines: z.array(z.object({ variantId: uuidSchema, quantity: quantitySchema })).min(1, 'Agregá al menos un artículo').max(200),
});
export type StockWasteInput = z.infer<typeof stockWasteSchema>;

export const createStockCountSchema = z.object({
  warehouseId: uuidSchema,
  scope: z.enum(['total', 'partial']),
  notes: optionalText(300),
});

export const stockCountLinesSchema = z.object({
  lines: z.array(z.object({ variantId: uuidSchema, counted: quantitySchema.nullable() })).min(1).max(500),
});

export const PRICE_RULE_KINDS = ['percent', 'fixed', 'markup', 'margin'] as const;
export type PriceRuleKind = (typeof PRICE_RULE_KINDS)[number];
export const PRICE_RULE_LABELS: Record<PriceRuleKind, string> = {
  percent: 'Aumentar o bajar un porcentaje del precio',
  fixed: 'Sumar o restar un monto fijo',
  markup: 'Recargo sobre el costo',
  margin: 'Margen sobre el precio de venta',
};

export const bulkPriceSchema = z.object({
  scope: z.object({
    categoryId: uuidSchema.nullable(),
    brandId: uuidSchema.nullable(),
    productIds: z.array(uuidSchema).max(1000).nullable(),
  }),
  rule: z.object({
    kind: z.enum(PRICE_RULE_KINDS),
    value: z.string().trim().regex(/^-?\d{1,10}(\.\d{1,2})?$/, 'Valor inválido'),
  }),
  roundingStep: z.union([z.literal(0), z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]),
});
export type BulkPriceInput = z.infer<typeof bulkPriceSchema>;

export const applyBulkPriceSchema = bulkPriceSchema.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });
