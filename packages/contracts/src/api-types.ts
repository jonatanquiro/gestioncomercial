import type { PermissionCode } from './permissions';
import type { Appearance, PaymentKind, SaleMode, SalePaymentKind, TaxCondition, TenantSettings, VatRate } from './schemas';

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
  user: { id: string; name: string; email: string | null; username: string | null };
  tenant: { id: string; tradeName: string; status: string; businessTypeCode: string } | null;
  role: { id: string; name: string } | null;
  /** Estado del cobro del comercio activo. */
  subscription: SubscriptionStateDto | null;
  permissions: PermissionCode[];
  branchIds: string[];
  memberships: MembershipSummary[];
}

/**
 * free: sin vencimiento · trial: en prueba · active: pagada · grace: vencida, todavía opera ·
 * expired: pausada hasta que se pague.
 */
export type SubscriptionState = 'free' | 'trial' | 'active' | 'grace' | 'expired';

export interface SubscriptionStateDto {
  state: SubscriptionState;
  /** Fin de la prueba o del período pagado. */
  dueAt: string | null;
  /** Desde cuándo se pausa si no se paga. */
  blockAt: string | null;
  freeForever: boolean;
}

export interface SubscriptionPlanDto {
  code: string;
  name: string;
  /** Precio por mes. */
  price: string;
  currency: string;
  limits: Record<string, number>;
}

export interface SubscriptionPaymentDto {
  id: string;
  planName: string | null;
  months: number;
  amount: string;
  currency: string;
  method: 'mercadopago' | 'manual';
  status: 'pending' | 'approved' | 'rejected' | 'refunded' | 'error';
  periodFrom: string | null;
  periodTo: string | null;
  createdAt: string;
}

export interface SubscriptionDto extends SubscriptionStateDto {
  plan: SubscriptionPlanDto | null;
  /** Planes que se pueden pagar (activos y con precio). */
  plans: SubscriptionPlanDto[];
  monthOptions: number[];
  graceDays: number;
  /** Hay credencial de Mercado Pago configurada. */
  mercadoPago: boolean;
  payments: SubscriptionPaymentDto[];
}

export interface SubscriptionCheckoutResult {
  id: string;
  /** Dirección de Mercado Pago a la que se manda a la persona. */
  url: string;
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
  appearance?: Appearance;
  plan: { code: string; name: string; limits: Record<string, number>; features: string[] } | null;
  usage: { branches: number; users: number; products: number; hasSales: boolean };
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
  email: string | null;
  username: string | null;
  /** Trabaja solo en este comercio: el comercio puede ponerle una contraseña nueva. */
  canSetPassword: boolean;
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

export interface PlatformCreateTenantResult {
  id: string;
  /** Se invitó a un dueño nuevo a elegir su contraseña por correo. */
  ownerInvited: boolean;
  invitationSent: boolean;
  /** El dueño nuevo puede ingresar directamente con la contraseña definida en el alta. */
  ownerPasswordSet: boolean;
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
  billingState: SubscriptionState | null;
  dueAt: string | null;
  freeForever: boolean;
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

// ---------- Catálogo e inventario ----------

export interface CategoryDto {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  productCount: number;
}

export interface BrandDto {
  id: string;
  name: string;
}

export interface BarcodeDto {
  code: string;
  quantityFactor: string;
}

/** Variante activa de un producto: lo que se vende y se stockea. */
export interface ProductVariantDto {
  id: string;
  /** Valores en el orden de ProductDto.optionNames. */
  options: string[];
  /** «M / Rojo»; null si el producto no tiene propiedades. */
  label: string | null;
  sku: string | null;
  price: string;
  /** null si no hay costo cargado o si el usuario no tiene permiso para ver costos. */
  cost: string | null;
  barcodes: BarcodeDto[];
  /** Suma de todos los depósitos; null si no controla stock o el usuario no puede verlo. */
  stock: string | null;
}

export interface ProductDto {
  id: string;
  kind: 'good' | 'service';
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  saleMode: SaleMode;
  vatRate: VatRate;
  trackStock: boolean;
  /** Se aplica a cada variante. */
  minStock: string | null;
  blockNegativeStock: boolean;
  /** Propiedades (Talle, Color…); vacío si el producto tiene una sola variante. */
  optionNames: string[];
  /** Variantes activas; siempre al menos una. */
  variants: ProductVariantDto[];
  /** Suma de todas las variantes; null si no controla stock o el usuario no puede verlo. */
  stock: string | null;
  status: 'active' | 'inactive';
  version: number;
  updatedAt: string;
}

/** Una variante lista para vender o contar: lo que devuelven el buscador, el lector y los más vendidos. */
export interface ItemDto {
  productId: string;
  variantId: string;
  /** Nombre del producto. Para mostrar: variantDisplayName(name, variantLabel). */
  name: string;
  variantLabel: string | null;
  kind: 'good' | 'service';
  saleMode: SaleMode;
  trackStock: boolean;
  minStock: string | null;
  sku: string | null;
  price: string;
  /** Costo vigente; null si no tiene o el usuario no puede ver costos. */
  cost: string | null;
  barcodes: BarcodeDto[];
  /** null si no controla stock o el usuario no puede verlo. */
  stock: string | null;
  /** Estado del producto. */
  status: 'active' | 'inactive';
}

export interface ProductHistoryDto {
  prices: Array<{ variantLabel: string | null; price: string; validFrom: string; validTo: string | null; changedBy: string | null; batchId: string | null }>;
  /** Vacío si el usuario no puede ver costos. */
  costs: Array<{ variantLabel: string | null; cost: string; source: string; at: string; changedBy: string | null }>;
  changes: Array<{ at: string; actorName: string | null; action: string; before: unknown; after: unknown }>;
}

export interface ProductLookupDto {
  item: ItemDto;
  /** Unidades que representa el código leído (12 si es el código del pack). */
  quantityFactor: string;
}

/** Sugerencia del catálogo de referencia (datos abiertos de SEPA) para un código que el comercio no tiene. */
export interface ReferenceProductDto {
  code: string;
  name: string;
  brandName: string | null;
  /** Contenido de la etiqueta, por ejemplo "500 g" o "2,25 l". */
  presentation: string | null;
  source: 'sepa';
}

/** Resultado de la búsqueda en el catálogo de referencia. */
export interface ReferenceSearchItemDto extends ReferenceProductDto {
  /** El comercio ya tiene un producto con este código. */
  added: boolean;
}

export interface WarehouseDto {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  isDefault: boolean;
}

export interface StockRowDto {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  categoryName: string | null;
  saleMode: SaleMode;
  onHand: string;
  minStock: string | null;
  low: boolean;
  /** Solo con permiso para ver costos. */
  cost: string | null;
}

export type StockMovementType =
  | 'adjust' | 'waste' | 'expired' | 'count_adjust' | 'purchase_in' | 'sale_out' | 'return_in' | 'transfer_out' | 'transfer_in';

export interface StockMovementDto {
  id: string;
  occurredAt: string;
  type: StockMovementType;
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string | null;
  warehouseName: string;
  quantity: string;
  balanceAfter: string;
  unitCost: string | null;
  reason: string | null;
  userName: string | null;
  sourceType: string;
  sourceId: string | null;
}

export interface StockOperationResult {
  /** false si el pedido ya se había procesado (reintento con el mismo clientUuid). */
  created: boolean;
  movements: number;
}

export interface StockCountDto {
  id: string;
  warehouseId: string;
  warehouseName: string;
  scope: 'total' | 'partial';
  status: 'open' | 'closed' | 'cancelled';
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  closedAt: string | null;
  lineCount: number;
}

export interface StockCountLineDto {
  variantId: string;
  productId: string;
  name: string;
  variantLabel: string | null;
  sku: string | null;
  saleMode: SaleMode;
  expected: string;
  counted: string;
  difference: string;
  countedAt: string;
}

export interface StockCountDetailDto extends StockCountDto {
  lines: StockCountLineDto[];
}

export interface BulkPriceRowDto {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string | null;
  oldPrice: string;
  newPrice: string;
  /** Variación porcentual del precio. */
  variation: string | null;
  /** Solo con permiso para ver costos. */
  cost: string | null;
  markup: string | null;
  margin: string | null;
}

export interface BulkPricePreviewDto {
  rows: BulkPriceRowDto[];
  skipped: Array<{ productId: string; name: string; reason: string }>;
  /** Huella de la vista previa: aplicar exige la misma, así se aplica exactamente lo que se vio. */
  fingerprint: string;
}

// ---------------------------------------------------------------- Fase 4: ventas y caja

export interface RegisterDto {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  status: 'active' | 'inactive';
  openShift: { id: string; openedAt: string; openedByName: string } | null;
}

export interface PaymentMethodDto {
  id: string;
  name: string;
  kind: PaymentKind;
  requiresReference: boolean;
  active: boolean;
  sortOrder: number;
}

export interface SaleLineDto {
  id: string;
  variantId: string;
  description: string;
  saleMode: SaleMode;
  quantity: string;
  unitPrice: string;
  unitCost: string | null;
  discountPercent: string;
  discountAmount: string;
  vatRate: VatRate;
  total: string;
  returnedQuantity: string;
}

export interface SaleDto {
  id: string;
  number: number;
  status: 'confirmed' | 'voided';
  confirmedAt: string;
  branchName: string;
  registerId: string;
  registerName: string;
  shiftId: string;
  cashierName: string;
  subtotal: string;
  discountTotal: string;
  total: string;
  changeGiven: string;
  discountAuthorizedBy: string | null;
  /** Si la venta es la de una gift card: la tarjeta emitida. No tiene artículos. */
  giftCard: GiftCardDto | null;
  /** Si la venta es un cambio: la venta de la que salió el crédito. */
  exchangeOf: { saleId: string; saleNumber: number; credit: string } | null;
  lines: SaleLineDto[];
  payments: Array<{ paymentMethodId: string; name: string; kind: SalePaymentKind; amount: string; reference: string | null; payerName: string | null; payerPhone: string | null }>;
  void: { at: string; byName: string; authorizedByName: string | null; reason: string } | null;
  returns: Array<{
    id: string;
    number: number;
    createdAt: string;
    total: string;
    reason: string;
    paymentMethodName: string;
    userName: string;
    authorizedByName: string | null;
    /** La venta nueva, si la devolución fue parte de un cambio. */
    exchangeSale: { id: string; number: number } | null;
    lines: Array<{ saleLineId: string; quantity: string; amount: string; restock: boolean }>;
  }>;
}

export interface SaleSummaryDto {
  id: string;
  number: number;
  status: 'confirmed' | 'voided';
  confirmedAt: string;
  cashierName: string;
  registerName: string;
  total: string;
  returnedTotal: string;
  /** Código de la gift card si la venta es la de una tarjeta. */
  giftCardCode: string | null;
}

export type GiftCardState = 'active' | 'used' | 'expired' | 'voided';
export interface GiftCardDto {
  id: string;
  code: string;
  amount: string;
  balance: string;
  state: GiftCardState;
  /** Último día en que se puede usar (AAAA-MM-DD). */
  expiresOn: string;
  recipientName: string | null;
  fromName: string | null;
  createdAt: string;
  branchName: string;
  sale: { id: string; number: number };
  /** Solo en la consulta por código. */
  movements?: Array<{ kind: 'issue' | 'redeem' | 'reversal' | 'void'; amount: string; balanceAfter: string; createdAt: string; sale: { id: string; number: number } | null }>;
}

export interface GiftCardListDto extends Paginated<GiftCardDto> {
  /** Saldo vigente: lo que el comercio todavía debe entregar en mercadería. */
  outstanding: { count: number; amount: string };
}

export interface ShiftTotalsByMethod {
  paymentMethodId: string;
  name: string;
  kind: PaymentKind;
  sales: string;
  refunds: string;
  net: string;
}

export interface CashShiftDto {
  id: string;
  registerId: string;
  registerName: string;
  status: 'open' | 'closed';
  openingFloat: string;
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
  closedByName: string | null;
  salesCount: number;
  salesTotal: string;
  /** null mientras el turno está abierto, salvo con cash.read_all: el cierre es ciego. */
  expectedCash: string | null;
  countedCash: string | null;
  difference: string | null;
  totalsByMethod: ShiftTotalsByMethod[] | null;
  closingNotes: string | null;
  movements: Array<{ id: string; type: 'sale' | 'refund' | 'void' | 'withdrawal' | 'deposit'; amount: string; reason: string | null; userName: string; occurredAt: string }>;
  counts: Array<{ kind: 'partial' | 'closing'; counted: string; expected: string | null; difference: string | null; countedByName: string; countedAt: string }>;
}

export interface CashShiftSummaryDto {
  id: string;
  registerId: string;
  registerName: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
  closedByName: string | null;
  difference: string | null;
}

export interface AuthorizerDto {
  membershipId: string;
  name: string;
}

// ---------------------------------------------------------------- Compras (ADR 0014)

export interface SupplierDto {
  id: string;
  name: string;
  cuit: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
}

export interface PurchaseDto {
  id: string;
  number: number;
  createdAt: string;
  supplierId: string | null;
  supplierName: string | null;
  warehouseName: string;
  /** N° de factura o remito del proveedor. */
  document: string | null;
  notes: string | null;
  /** null si falta el costo de alguna línea o el usuario no puede ver costos. */
  totalCost: string | null;
  updatedCosts: boolean;
  createdByName: string | null;
  lineCount: number;
  /** Solo en el detalle. */
  lines: Array<{ variantId: string; description: string; quantity: string; unitCost: string | null }> | null;
}

