import type { PermissionCode } from './permissions';
import type { SaleMode, TaxCondition, TenantSettings, VatRate } from './schemas';

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

export interface PlatformCreateTenantResult {
  id: string;
  /** false si el email ya tenía cuenta: entra con su contraseña de siempre. */
  ownerInvited: boolean;
  invitationSent: boolean;
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

export interface ProductDto {
  id: string;
  variantId: string;
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
  minStock: string | null;
  blockNegativeStock: boolean;
  sku: string | null;
  price: string;
  /** null si no hay costo cargado o si el usuario no tiene permiso para ver costos. */
  cost: string | null;
  barcodes: BarcodeDto[];
  /** Suma de todos los depósitos; null si no controla stock o el usuario no puede verlo. */
  stock: string | null;
  status: 'active' | 'inactive';
  version: number;
  updatedAt: string;
}

export interface ProductHistoryDto {
  prices: Array<{ price: string; validFrom: string; validTo: string | null; changedBy: string | null; batchId: string | null }>;
  /** Vacío si el usuario no puede ver costos. */
  costs: Array<{ cost: string; source: string; at: string; changedBy: string | null }>;
  changes: Array<{ at: string; actorName: string | null; action: string; before: unknown; after: unknown }>;
}

export interface ProductLookupDto {
  product: ProductDto;
  /** Unidades que representa el código leído (12 si es el código del pack). */
  quantityFactor: string;
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
