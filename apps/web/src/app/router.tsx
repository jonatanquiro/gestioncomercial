import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { AccountPage } from '@/features/account/account-page';
import { AuditPage } from '@/features/audit/audit-page';
import { LoginPage } from '@/features/auth/login-page';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/password-pages';
import { RegisterPage } from '@/features/auth/register-page';
import { BranchesPage } from '@/features/branches/branches-page';
import { CashPage, ShiftPage } from '@/features/cash/cash-page';
import { CashSetupPage } from '@/features/cash/setup-page';
import { SettlementsPage } from '@/features/cash/settlements-page';
import { PaymentsPage } from '@/features/cash/payments-page';
import { CategoriesPage } from '@/features/catalog/categories-page';
import { PricesPage } from '@/features/catalog/prices-page';
import { ProductsPage } from '@/features/catalog/products-page';
import { ReferenceCatalogPage } from '@/features/catalog/reference-catalog-page';
import { EmployeesPage } from '@/features/employees/employees-page';
import { HomePage } from '@/features/home/home-page';
import { AppLayout, NoTenantPage } from '@/features/layout/app-layout';
import { PlatformLayout } from '@/features/platform/platform-layout';
import { PlatformLoginPage } from '@/features/platform/platform-login-page';
import { platformMeQuery } from '@/features/platform/platform-session';
import { PlatformPlansPage } from '@/features/platform/plans-page';
import { PlatformTenantsPage } from '@/features/platform/tenants-page';
import { RolesPage } from '@/features/roles/roles-page';
import { PosPage } from '@/features/sales/pos-page';
import { CustomerDetailPage, CustomersPage } from '@/features/customers/customers-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { PromotionsPage } from '@/features/promotions/promotions-page';
import { GiftCardsPage } from '@/features/gift-cards/gift-cards-page';
import { SaleDetailPage, SalesPage } from '@/features/sales/sales-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { AppearancePage } from '@/features/settings/appearance-page';
import { FiscalPage } from '@/features/settings/fiscal-page';
import { CountDetailPage, CountsPage } from '@/features/stock/counts-page';
import { NewPurchasePage, PurchaseDetailPage, PurchasesPage } from '@/features/purchases/purchases-page';
import { SupplierDetailPage } from '@/features/purchases/supplier-page';
import { LabelsPage } from '@/features/catalog/labels-page';
import { SubscriptionExpiredPage, SubscriptionPage } from '@/features/subscription/subscription-page';
import { MovementsPage } from '@/features/stock/movements-page';
import { StockPage } from '@/features/stock/stock-page';
import { ApiRequestError, http } from '@/lib/api';
import { appBasePath, appUrl, internalPath } from '@/lib/base-path';
import { meQuery } from '@/lib/session';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="flex min-h-full items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">Página no encontrada</h1>
        <a href={appUrl('/app')} className="mt-2 inline-block text-sm text-brand-700 hover:underline">
          Volver al inicio
        </a>
      </div>
    </main>
  ),
});

/** Si la sesión no es válida, la API responde 401 y se redirige al ingreso correspondiente. */
function redirectOn401(err: unknown, to: '/login' | '/plataforma/login'): never {
  if (err instanceof ApiRequestError && err.status === 401) throw redirect({ to });
  throw err;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/app' });
  },
});

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/registro', component: RegisterPage });
const forgotRoute = createRoute({ getParentRoute: () => rootRoute, path: '/recuperar', component: ForgotPasswordPage });
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/restablecer',
  validateSearch: z.object({ token: z.string().catch('') }),
  component: ResetPasswordPage,
});

function AppGate() {
  const me = useQuery(meQuery).data!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me.tenant) return <NoTenantPage reason="none" />;
  if (me.tenant.status === 'suspended' || me.tenant.status === 'cancelled') return <NoTenantPage reason="suspended" />;
  if (me.subscription?.state === 'expired') {
    return <SubscriptionExpiredPage onLogout={async () => {
      await http.post('/auth/logout').catch(() => undefined);
      queryClient.clear();
      await navigate({ to: '/login' });
    }} />;
  }
  return <AppLayout />;
}

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(meQuery).catch((err: unknown) => redirectOn401(err, '/login'));
  },
  component: AppGate,
});

const appIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage });
const branchesRoute = createRoute({ getParentRoute: () => appRoute, path: 'sucursales', component: BranchesPage });
const employeesRoute = createRoute({ getParentRoute: () => appRoute, path: 'empleados', component: EmployeesPage });
const rolesRoute = createRoute({ getParentRoute: () => appRoute, path: 'roles', component: RolesPage });
const auditRoute = createRoute({ getParentRoute: () => appRoute, path: 'auditoria', component: AuditPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: 'configuracion', component: SettingsPage });
const appearanceRoute = createRoute({ getParentRoute: () => appRoute, path: 'apariencia', component: AppearancePage });
const fiscalRoute = createRoute({ getParentRoute: () => appRoute, path: 'facturacion', component: FiscalPage, validateSearch: z.object({ saleId: z.string().uuid().optional().catch(undefined) }) });
const accountRoute = createRoute({ getParentRoute: () => appRoute, path: 'cuenta', component: AccountPage });
// Mercado Pago vuelve con ?pago=<id>&payment_id=...; el resto de sus parámetros se ignora.
const subscriptionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'suscripcion',
  validateSearch: z.object({
    pago: z.string().uuid().optional().catch(undefined),
    payment_id: z.string().max(40).optional().catch(undefined),
    collection_id: z.string().max(40).optional().catch(undefined),
  }),
  component: SubscriptionPage,
});
const productsRoute = createRoute({ getParentRoute: () => appRoute, path: 'productos', component: ProductsPage });
const referenceCatalogRoute = createRoute({ getParentRoute: () => appRoute, path: 'productos/catalogo', component: ReferenceCatalogPage });
const categoriesRoute = createRoute({ getParentRoute: () => appRoute, path: 'categorias', component: CategoriesPage });
const pricesRoute = createRoute({ getParentRoute: () => appRoute, path: 'precios', component: PricesPage });
const labelsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'etiquetas',
  validateSearch: z.object({ productId: z.string().uuid().optional().catch(undefined) }),
  component: LabelsPage,
});
const stockRoute = createRoute({ getParentRoute: () => appRoute, path: 'stock', component: StockPage });
const movementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'stock/movimientos',
  validateSearch: z.object({ productId: z.string().uuid().optional().catch(undefined) }),
  component: MovementsPage,
});
const countsRoute = createRoute({ getParentRoute: () => appRoute, path: 'inventarios', component: CountsPage });
const purchasesRoute = createRoute({ getParentRoute: () => appRoute, path: 'compras', component: PurchasesPage });
const newPurchaseRoute = createRoute({ getParentRoute: () => appRoute, path: 'compras/nueva', component: NewPurchasePage });
const supplierDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'compras/proveedores/$id', component: SupplierDetailPage });
const purchaseDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'compras/$id', component: PurchaseDetailPage });
const countDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'inventarios/$id', component: CountDetailPage });
const posRoute = createRoute({ getParentRoute: () => appRoute, path: 'vender', component: PosPage });
const customersRoute = createRoute({ getParentRoute: () => appRoute, path: 'clientes', component: CustomersPage });
const customerDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'clientes/$id', component: CustomerDetailPage });
const reportsRoute = createRoute({ getParentRoute: () => appRoute, path: 'reportes', component: ReportsPage });
const promotionsRoute = createRoute({ getParentRoute: () => appRoute, path: 'promociones', component: PromotionsPage });
const giftCardsRoute = createRoute({ getParentRoute: () => appRoute, path: 'gift-cards', component: GiftCardsPage });
const salesRoute = createRoute({ getParentRoute: () => appRoute, path: 'ventas', component: SalesPage, validateSearch: z.object({ numero: z.number().int().positive().optional().catch(undefined) }) });
const saleDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'ventas/$id', component: SaleDetailPage });
const cashRoute = createRoute({ getParentRoute: () => appRoute, path: 'caja', component: CashPage });
const shiftRoute = createRoute({ getParentRoute: () => appRoute, path: 'caja/$id', component: ShiftPage });
const cashSetupRoute = createRoute({ getParentRoute: () => appRoute, path: 'cajas', component: CashSetupPage });
const settlementsRoute = createRoute({ getParentRoute: () => appRoute, path: 'rendiciones', component: SettlementsPage, validateSearch: z.object({ id: z.string().uuid().optional().catch(undefined) }) });
const paymentsRoute = createRoute({ getParentRoute: () => appRoute, path: 'cobros', component: PaymentsPage });

const platformLoginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/plataforma/login', component: PlatformLoginPage });

const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plataforma',
  beforeLoad: async ({ context, location }) => {
    if (internalPath(location.pathname) === '/plataforma/login') return;
    await context.queryClient.ensureQueryData(platformMeQuery).catch((err: unknown) => redirectOn401(err, '/plataforma/login'));
  },
  component: PlatformLayout,
});

const platformIndexRoute = createRoute({ getParentRoute: () => platformRoute, path: '/', component: PlatformTenantsPage });
const platformPlansRoute = createRoute({ getParentRoute: () => platformRoute, path: 'planes', component: PlatformPlansPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotRoute,
  resetRoute,
  appRoute.addChildren([
    appIndexRoute,
    posRoute,
    salesRoute,
    giftCardsRoute,
    promotionsRoute,
    reportsRoute,
    customersRoute,
    customerDetailRoute,
    saleDetailRoute,
    cashRoute,
    shiftRoute,
    cashSetupRoute,
    settlementsRoute,
    paymentsRoute,
    productsRoute,
    referenceCatalogRoute,
    categoriesRoute,
    pricesRoute,
    stockRoute,
    movementsRoute,
    countsRoute,
    purchasesRoute,
    labelsRoute,
    newPurchaseRoute,
    purchaseDetailRoute,
    supplierDetailRoute,
    countDetailRoute,
    branchesRoute,
    employeesRoute,
    rolesRoute,
    auditRoute,
    settingsRoute,
    appearanceRoute,
    fiscalRoute,
    accountRoute,
    subscriptionRoute,
  ]),
  platformLoginRoute,
  platformRoute.addChildren([platformIndexRoute, platformPlansRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, basepath: appBasePath() || '/', context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
