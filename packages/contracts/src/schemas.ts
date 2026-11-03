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

/** Nombre de usuario para ingresar sin email (ADR 0010). Sin @, para distinguirlo del email. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'El usuario debe tener al menos 3 caracteres')
  .max(30, 'El usuario no puede superar 30 caracteres')
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Usá letras sin acentos, números, punto, guion o guion bajo, empezando por letra o número');

const optionalEmail = emailSchema.optional().nullable().or(z.literal('').transform(() => null));
const optionalUsername = usernameSchema.optional().nullable().or(z.literal('').transform(() => null));

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
  login: z.string().trim().toLowerCase().min(1, 'Obligatorio').max(254),
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

/** Descuento por línea: 0 a 100 con hasta 2 decimales. */
export const discountPercentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Descuento inválido')
  .refine((v) => Number.parseFloat(v) <= 100, 'El descuento no puede superar el 100%');

export const tenantSettingsSchema = z.object({
  allowNegativeStock: z.boolean(),
  priceRoundingStep: z.union([z.literal(0), z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]),
  /** Descuento máximo por línea con sales.discount; más arriba hace falta sales.discount_unlimited o un PIN. */
  discountLimitPercent: discountPercentSchema,
  /** Mostrar «Agregar desde catálogo» (Precios Claros). El valor inicial depende del rubro. */
  referenceCatalog: z.boolean(),
  /** Días para cambiar lo comprado, impresos en el ticket de cambio. 0: sin plazo. */
  exchangeDays: z.number({ message: 'Ingresá un número de días' }).int('Ingresá un número entero de días').min(0, 'No puede ser negativo').max(365, 'Como máximo 365 días'),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const appearanceSchema = z.object({
  logoData: z.string().max(350000).nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), menuColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.enum(['system', 'archivo', 'serif']), navigation: z.enum(['side', 'top']),
  textSize: z.enum(['normal', 'large']), density: z.enum(['normal', 'compact']),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const updateTenantSchema = z.object({
  tradeName: trimmed(120),
  legalName: optionalText(160),
  cuit: cuitSchema.optional().nullable().or(z.literal('').transform(() => null)),
  taxCondition: taxConditionSchema,
  address: optionalText(200),
  phone: optionalText(40),
  email: optionalEmail,
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

export const createEmployeeSchema = z
  .object({
    name: trimmed(120),
    username: optionalUsername,
    email: optionalEmail,
    password: passwordSchema,
    roleId: uuidSchema,
    branchIds: z.array(uuidSchema).min(1, 'Elegí al menos una sucursal').max(100),
  })
  .refine((v) => v.username || v.email, { path: ['username'], message: 'Indicá un nombre de usuario o un email' });
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateMembershipSchema = z.object({
  roleId: uuidSchema,
  branchIds: z.array(uuidSchema).min(1, 'Elegí al menos una sucursal').max(100),
  status: z.enum(['active', 'inactive']),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

/** Contraseña que el comercio le pone a alguien que trabaja solo ahí (por ejemplo, sin email). */
export const setEmployeePasswordSchema = z.object({ password: passwordSchema });

export const updateUsernameSchema = z.object({ username: optionalUsername });

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

/** Alta manual: contraseña inicial opcional; sin ella se invita al dueño por correo. */
export const platformCreateTenantSchema = z.object({
  tradeName: trimmed(120),
  legalName: optionalText(160),
  cuit: cuitSchema.optional().nullable().or(z.literal('').transform(() => null)),
  taxCondition: taxConditionSchema,
  businessTypeCode: trimmed(40),
  planCode: trimmed(40),
  ownerName: trimmed(120),
  ownerEmail: emailSchema,
  ownerPassword: z.union([passwordSchema, z.literal('')]).nullable().optional(),
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

/** Hasta 3 propiedades por producto (Talle, Color…), como en Tienda Nube. ADR 0013. */
export const MAX_PRODUCT_OPTIONS = 3;
export const MAX_PRODUCT_VARIANTS = 100;

const variantSchema = z.object({
  /** Variante existente que se edita; null para una nueva. */
  id: uuidSchema.nullable(),
  /** Valores de cada propiedad, en el orden de optionNames. */
  options: z.array(z.string().trim().min(1, 'Obligatorio').max(40)).max(MAX_PRODUCT_OPTIONS),
  sku: optionalText(60),
  price: moneySchema,
  cost: costSchema.nullable(),
  barcodes: z.array(barcodeSchema).max(20),
  /** Stock inicial en el depósito principal, solo para variantes nuevas (necesita el permiso de ajustar stock). */
  initialStock: quantitySchema.nullable(),
});
export type VariantInput = z.infer<typeof variantSchema>;

/** «M / Rojo»: la etiqueta con la que se muestra la variante. null si el producto no tiene propiedades. */
export const variantLabel = (options: string[]): string | null => (options.length === 0 ? null : options.join(' / '));
/** «Remera · M / Rojo». */
export const variantDisplayName = (productName: string, label: string | null): string => (label ? `${productName} · ${label}` : productName);

const productShape = z.object({
  kind: z.enum(PRODUCT_KINDS),
  name: trimmed(160),
  description: optionalText(500),
  categoryId: uuidSchema.nullable(),
  brandId: uuidSchema.nullable(),
  saleMode: z.enum(SALE_MODES),
  vatRate: z.enum(VAT_RATES),
  trackStock: z.boolean(),
  /** Se aplica a cada variante. */
  minStock: quantitySchema.nullable(),
  blockNegativeStock: z.boolean(),
  optionNames: z.array(z.string().trim().min(1, 'Obligatorio').max(30)).max(MAX_PRODUCT_OPTIONS, `Hasta ${MAX_PRODUCT_OPTIONS} propiedades`),
  variants: z.array(variantSchema).min(1, 'Agregá al menos una variante').max(MAX_PRODUCT_VARIANTS, `Hasta ${MAX_PRODUCT_VARIANTS} variantes por producto`),
});

/** Reglas entre campos, las mismas que ProductsController::validated. */
function refineProduct(p: z.infer<typeof productShape>, ctx: z.RefinementCtx) {
  const names = new Set<string>();
  p.optionNames.forEach((n, i) => {
    if (names.has(n.toLowerCase())) ctx.addIssue({ code: 'custom', path: ['optionNames', i], message: 'Propiedad repetida' });
    names.add(n.toLowerCase());
  });
  if (p.optionNames.length === 0 && p.variants.length > 1) {
    ctx.addIssue({ code: 'custom', path: ['optionNames'], message: 'Para cargar variantes, agregá al menos una propiedad (talle, color…)' });
  }
  const combos = new Set<string>();
  const skus = new Set<string>();
  const codes = new Set<string>();
  p.variants.forEach((v, i) => {
    if (v.options.length !== p.optionNames.length) {
      ctx.addIssue({ code: 'custom', path: ['variants', i, 'options'], message: 'Completá todas las propiedades' });
    } else if (p.optionNames.length > 0) {
      const key = v.options.join('\u0000').toLowerCase();
      if (combos.has(key)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'options'], message: 'Esta combinación ya está cargada' });
      combos.add(key);
    }
    if (v.sku) {
      if (skus.has(v.sku)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'Código repetido' });
      skus.add(v.sku);
    }
    v.barcodes.forEach((b, j) => {
      if (codes.has(b.code)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'barcodes', j, 'code'], message: 'Código repetido' });
      codes.add(b.code);
    });
    if (p.saleMode === 'unit') {
      const quantities: Array<[string | null, (string | number)[]]> = [
        [v.initialStock, ['variants', i, 'initialStock']],
        ...v.barcodes.map((b, j): [string, (string | number)[]] => [b.quantityFactor, ['variants', i, 'barcodes', j, 'quantityFactor']]),
      ];
      for (const [q, path] of quantities) {
        if (q !== null && !Number.isInteger(Number(q))) ctx.addIssue({ code: 'custom', path, message: 'En la venta por unidad, la cantidad tiene que ser entera' });
      }
    }
  });
  if (p.saleMode === 'unit' && p.minStock !== null && !Number.isInteger(Number(p.minStock))) {
    ctx.addIssue({ code: 'custom', path: ['minStock'], message: 'En la venta por unidad, la cantidad tiene que ser entera' });
  }
}

export const createProductSchema = productShape.superRefine((p, ctx) => {
  refineProduct(p, ctx);
  p.variants.forEach((v, i) => {
    if (v.id !== null) ctx.addIssue({ code: 'custom', path: ['variants', i, 'id'], message: 'Identificador inválido' });
  });
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** Alta de varios productos del catálogo de referencia (SEPA), cada uno con su precio. */
export const addReferenceProductsSchema = z.object({
  categoryId: uuidSchema.nullable(),
  items: z
    .array(z.object({
      code: z.string().trim().regex(/^\d{6,14}$/, 'Código inválido'),
      price: moneySchema,
      initialStock: quantitySchema.refine((v) => Number.isInteger(Number(v)), 'En la venta por unidad, la cantidad tiene que ser entera').nullable().optional(),
    }))
    .min(1, 'Elegí al menos un producto')
    .max(100, 'Hasta 100 productos por vez'),
});
export type AddReferenceProductsInput = z.infer<typeof addReferenceProductsSchema>;

export const updateProductSchema = productShape.extend({ version: z.number().int().min(1) }).superRefine((p, ctx) => {
  refineProduct(p, ctx);
  p.variants.forEach((v, i) => {
    if (v.id !== null && v.initialStock !== null) {
      ctx.addIssue({ code: 'custom', path: ['variants', i, 'initialStock'], message: 'El stock de una variante existente se cambia con un ajuste' });
    }
  });
});
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

// ---------------------------------------------------------------- Fase 4: ventas y caja

export const PAYMENT_KINDS = ['cash', 'debit', 'credit', 'transfer', 'qr', 'other'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
/** En los pagos de una venta también aparecen el crédito por cambio y la gift card, que son internos y no se configuran. */
export type SalePaymentKind = PaymentKind | 'exchange' | 'gift_card' | 'account';
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  cash: 'Efectivo',
  debit: 'Tarjeta de débito',
  credit: 'Tarjeta de crédito',
  transfer: 'Transferencia',
  qr: 'QR o billetera virtual',
  other: 'Otro',
};

export const pinAuthorizationSchema = z.object({ membershipId: uuidSchema, pin: z.string().regex(/^\d{4,6}$/) });
export type PinAuthorizationInput = z.infer<typeof pinAuthorizationSchema>;

const positiveMoney = moneySchema.refine((v) => !/^0+(\.0+)?$/.test(v), 'El importe no puede ser cero');
const positiveQuantity = quantitySchema.refine((v) => !/^0+(\.0+)?$/.test(v), 'La cantidad no puede ser cero');

export const createSaleSchema = z.object({
  clientUuid: uuidSchema,
  registerId: uuidSchema,
  lines: z
    .array(z.object({ variantId: uuidSchema, quantity: positiveQuantity, discountPercent: discountPercentSchema }))
    .min(1, 'Agregá al menos un artículo')
    .max(300),
  payments: z
    .array(
      z.object({
        paymentMethodId: uuidSchema,
        amount: positiveMoney,
        reference: optionalText(80),
        /** Quién transfiere o paga con QR: lo piden muchos comercios para identificar el cobro. */
        payerName: optionalText(120),
        payerPhone: optionalText(30).refine((v) => !v || /^[\d\s()+-]{6,30}$/.test(v), 'Teléfono inválido'),
      }),
    )
    .max(10),
  /** Cliente de la venta (opcional) y lo que se le carga a su cuenta corriente (ADR 0016). */
  customerId: uuidSchema.nullable().optional(),
  accountAmount: positiveMoney.nullable().optional(),
  /** Gift cards con que se paga primero (ADR 0015). */
  giftCards: z
    .array(z.object({ code: z.string().trim().min(1, 'Obligatorio').max(30), amount: positiveMoney }))
    .max(5)
    .refine((cards) => new Set(cards.map((c) => c.code.toUpperCase())).size === cards.length, 'La gift card está repetida')
    .optional(),
  expectedTotal: moneySchema,
  authorization: pinAuthorizationSchema.nullable().optional(),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/** Cambio (ADR 0014): lo devuelto de la venta queda como crédito que paga esta venta nueva. */
export const createExchangeSchema = createSaleSchema.extend({
  reason: trimmed(180),
  returnLines: z
    .array(z.object({ saleLineId: uuidSchema, quantity: positiveQuantity, restock: z.boolean() }))
    .min(1, 'Elegí qué se devuelve')
    .max(300),
});
export type CreateExchangeInput = z.infer<typeof createExchangeSchema>;

/** Gift card (ADR 0015): se vende por un monto y vale hasta 6 meses. */
export const GIFT_CARD_MAX_MONTHS = 6;
export const createGiftCardSchema = z.object({
  clientUuid: uuidSchema,
  registerId: uuidSchema,
  amount: positiveMoney,
  validMonths: z.number().int().min(1, `La validez va de 1 a ${GIFT_CARD_MAX_MONTHS} meses`).max(GIFT_CARD_MAX_MONTHS, `La validez va de 1 a ${GIFT_CARD_MAX_MONTHS} meses`),
  recipientName: optionalText(80),
  fromName: optionalText(80),
  payments: createSaleSchema.shape.payments,
});
export type CreateGiftCardInput = z.infer<typeof createGiftCardSchema>;

// ---------------------------------------------------------------- Clientes y cuenta corriente (ADR 0016)

/** Tipos de documento de ARCA que se cargan en un cliente. */
export const CUSTOMER_DOCUMENT_TYPES = { 96: 'DNI', 80: 'CUIT', 86: 'CUIL' } as const;
/** Condición frente al IVA con el código de ARCA. */
export const CUSTOMER_VAT_CONDITIONS = { 5: 'Consumidor final', 6: 'Monotributo', 1: 'Responsable inscripto', 4: 'Exento' } as const;

export const customerSchema = z
  .object({
    name: trimmed(120),
    documentType: z.union([z.literal(96), z.literal(80), z.literal(86)]).nullable(),
    documentNumber: z.string().trim().transform((v) => v.replace(/\D/g, '')).nullable(),
    vatCondition: z.union([z.literal(5), z.literal(6), z.literal(1), z.literal(4)]),
    phone: optionalText(30),
    email: optionalEmail,
    address: optionalText(200),
    notes: optionalText(300),
    /** Tope de deuda; null: no se le vende a cuenta corriente. */
    creditLimit: moneySchema.nullable(),
  })
  .superRefine((c, ctx) => {
    const number = c.documentNumber || null;
    if ((c.documentType === null) !== (number === null)) ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'Completá el tipo y el número de documento, o ninguno' });
    else if (c.documentType === 96 && !/^\d{6,9}$/.test(number!)) ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'Ingresá un DNI válido, sin puntos' });
    else if ((c.documentType === 80 || c.documentType === 86) && !isValidCuit(number!)) ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'El CUIT o CUIL no es válido' });
  });
export type CustomerInput = z.infer<typeof customerSchema>;
export const updateCustomerSchema = customerSchema.and(z.object({ status: z.enum(['active', 'inactive']) }));

/** Cobro de deuda: se cobra como una venta, con cualquier medio. */
export const collectAccountSchema = z.object({ clientUuid: uuidSchema, registerId: uuidSchema, amount: positiveMoney, payments: createSaleSchema.shape.payments });
export const adjustAccountSchema = z.object({
  amount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'Importe inválido').refine((v) => !/^-?0+(\.0+)?$/.test(v), 'El importe no puede ser cero'),
  notes: trimmed(200),
});

export const voidSaleSchema = z.object({ reason: trimmed(200), authorization: pinAuthorizationSchema.nullable().optional() });

export const createSaleReturnSchema = z.object({
  clientUuid: uuidSchema,
  registerId: uuidSchema,
  reason: trimmed(200),
  paymentMethodId: uuidSchema,
  lines: z.array(z.object({ saleLineId: uuidSchema, quantity: positiveQuantity, restock: z.boolean() })).min(1, 'Elegí qué se devuelve').max(300),
  authorization: pinAuthorizationSchema.nullable().optional(),
});
export type CreateSaleReturnInput = z.infer<typeof createSaleReturnSchema>;

export const openShiftSchema = z.object({ registerId: uuidSchema, openingFloat: moneySchema });
export const cashMovementSchema = z.object({ type: z.enum(['withdrawal', 'deposit']), amount: positiveMoney, reason: trimmed(200) });
export const cashCountSchema = z.object({ counted: moneySchema });
export const closeShiftSchema = z.object({ counted: moneySchema, notes: optionalText(300) });

export const registerSchema = z.object({ branchId: uuidSchema, name: trimmed(60) });
export const updateRegisterSchema = z.object({ name: trimmed(60), status: z.enum(['active', 'inactive']) });

export const paymentMethodSchema = z.object({
  name: trimmed(60),
  kind: z.enum(PAYMENT_KINDS),
  requiresReference: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;

/** Pago a un proveedor: en efectivo sale de una caja abierta (ADR 0018). */
export const SUPPLIER_PAYMENT_METHODS = { cash: 'Efectivo de la caja', transfer: 'Transferencia', check: 'Cheque', other: 'Otro' } as const;
export const supplierPaymentSchema = z
  .object({
    clientUuid: uuidSchema,
    amount: positiveMoney,
    method: z.enum(['cash', 'transfer', 'check', 'other']),
    registerId: uuidSchema.nullable(),
    reference: optionalText(80),
    notes: optionalText(200),
  })
  .refine((p) => p.method !== 'cash' || p.registerId, { path: ['registerId'], message: 'Elegí la caja de la que sale el efectivo' });

/** Promoción (ADR 0020): porcentaje o N×M sobre todo, una categoría o un producto. */
export const promotionSchema = z
  .object({
    name: trimmed(80),
    kind: z.enum(['percent', 'nxm']),
    percent: discountPercentSchema.nullable(),
    buyQuantity: z.number().int().min(2, 'Tiene que llevar al menos 2').max(100).nullable(),
    payQuantity: z.number().int().min(1).max(99).nullable(),
    scope: z.enum(['all', 'category', 'product']),
    categoryId: uuidSchema.nullable(),
    productId: uuidSchema.nullable(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.kind === 'percent' && (!p.percent || Number(p.percent) <= 0)) ctx.addIssue({ code: 'custom', path: ['percent'], message: 'Ingresá el porcentaje' });
    if (p.kind === 'nxm' && !p.buyQuantity) ctx.addIssue({ code: 'custom', path: ['buyQuantity'], message: 'Ingresá cuántas lleva' });
    if (p.kind === 'nxm' && !p.payQuantity) ctx.addIssue({ code: 'custom', path: ['payQuantity'], message: 'Ingresá cuántas paga' });
    if (p.kind === 'nxm' && p.buyQuantity && p.payQuantity && p.payQuantity >= p.buyQuantity) ctx.addIssue({ code: 'custom', path: ['payQuantity'], message: 'Tiene que pagar menos de las que lleva' });
    if (p.scope === 'category' && !p.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Elegí la categoría' });
    if (p.scope === 'product' && !p.productId) ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Elegí el producto' });
    if (p.startsOn && p.endsOn && p.endsOn < p.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'La fecha de fin no puede ser anterior a la de inicio' });
  });
export type PromotionInput = z.infer<typeof promotionSchema>;

export const posPinSchema = z.object({
  password: z.string().min(1, 'Obligatorio'),
  pin: z.string().regex(/^\d{4,6}$/, 'El PIN tiene que tener de 4 a 6 números'),
});

// ---------- Suscripción (ADR 0012) ----------

/** Meses que se pueden pagar juntos con Mercado Pago (BillingService::MONTH_OPTIONS). */
export const SUBSCRIPTION_MONTH_OPTIONS = [1, 3, 6, 12] as const;

export const subscriptionCheckoutSchema = z.object({
  planCode: trimmed(40),
  months: z.literal(SUBSCRIPTION_MONTH_OPTIONS, 'Valor inválido'),
});

export const setTenantLicenseSchema = z.object({
  freeForever: z.boolean(),
  reason: trimmed(300),
});

/** Pago recibido por otro medio (transferencia), registrado por el operador. */
export const recordTenantPaymentSchema = z.object({
  months: z.number().int().min(1, 'Entre 1 y 36 meses').max(36, 'Entre 1 y 36 meses'),
  amount: moneySchema,
  notes: trimmed(300),
});

// ---------------------------------------------------------------- Compras (ADR 0014)

export const supplierSchema = z.object({
  name: trimmed(120),
  cuit: cuitSchema.optional().nullable().or(z.literal('').transform(() => null)),
  phone: optionalText(30),
  email: emailSchema.optional().nullable().or(z.literal('').transform(() => null)),
  notes: optionalText(300),
});
export type SupplierInput = z.infer<typeof supplierSchema>;
export const updateSupplierSchema = supplierSchema.extend({ status: z.enum(['active', 'inactive']) });

/** Ingreso de mercadería: el costo es opcional y, con updateCosts, pasa a ser el costo vigente. */
export const createPurchaseSchema = z.object({
  clientUuid: uuidSchema,
  warehouseId: uuidSchema,
  supplierId: uuidSchema.nullable(),
  document: optionalText(60),
  notes: optionalText(300),
  updateCosts: z.boolean(),
  /** Lo que queda para pagar al proveedor (la factura, con impuestos); requiere proveedor (ADR 0018). */
  payableAmount: positiveMoney.nullable().optional(),
  lines: z
    .array(z.object({ variantId: uuidSchema, quantity: positiveQuantity, unitCost: costSchema.nullable() }))
    .min(1, 'Agregá al menos un artículo')
    .max(300),
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

