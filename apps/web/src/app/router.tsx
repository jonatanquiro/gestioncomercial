import { QueryClient, useQuery } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { AccountPage } from '@/features/account/account-page';
import { AuditPage } from '@/features/audit/audit-page';
import { LoginPage } from '@/features/auth/login-page';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/password-pages';
import { RegisterPage } from '@/features/auth/register-page';
import { BranchesPage } from '@/features/branches/branches-page';
import { CashPage, ShiftPage } from '@/features/cash/cash-page';
import { CashSetupPage } from '@/features/cash/setup-page';
import { CategoriesPage } from '@/features/catalog/categories-page';
import { PricesPage } from '@/features/catalog/prices-page';
import { ProductsPage } from '@/features/catalog/products-page';
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
import { SaleDetailPage, SalesPage } from '@/features/sales/sales-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { CountDetailPage, CountsPage } from '@/features/stock/counts-page';
import { MovementsPage } from '@/features/stock/movements-page';
import { StockPage } from '@/features/stock/stock-page';
import { ApiRequestError } from '@/lib/api';
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
        <a href="/app" className="mt-2 inline-block text-sm text-brand-700 hover:underline">
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
  if (!me.tenant) return <NoTenantPage reason="none" />;
  if (me.tenant.status === 'suspended' || me.tenant.status === 'cancelled') return <NoTenantPage reason="suspended" />;
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
const accountRoute = createRoute({ getParentRoute: () => appRoute, path: 'cuenta', component: AccountPage });
const productsRoute = createRoute({ getParentRoute: () => appRoute, path: 'productos', component: ProductsPage });
const categoriesRoute = createRoute({ getParentRoute: () => appRoute, path: 'categorias', component: CategoriesPage });
const pricesRoute = createRoute({ getParentRoute: () => appRoute, path: 'precios', component: PricesPage });
const stockRoute = createRoute({ getParentRoute: () => appRoute, path: 'stock', component: StockPage });
const movementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'stock/movimientos',
  validateSearch: z.object({ productId: z.string().uuid().optional().catch(undefined) }),
  component: MovementsPage,
});
const countsRoute = createRoute({ getParentRoute: () => appRoute, path: 'inventarios', component: CountsPage });
const countDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'inventarios/$id', component: CountDetailPage });
const posRoute = createRoute({ getParentRoute: () => appRoute, path: 'vender', component: PosPage });
const salesRoute = createRoute({ getParentRoute: () => appRoute, path: 'ventas', component: SalesPage });
const saleDetailRoute = createRoute({ getParentRoute: () => appRoute, path: 'ventas/$id', component: SaleDetailPage });
const cashRoute = createRoute({ getParentRoute: () => appRoute, path: 'caja', component: CashPage });
const shiftRoute = createRoute({ getParentRoute: () => appRoute, path: 'caja/$id', component: ShiftPage });
const cashSetupRoute = createRoute({ getParentRoute: () => appRoute, path: 'cajas', component: CashSetupPage });

const platformLoginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/plataforma/login', component: PlatformLoginPage });

const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plataforma',
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === '/plataforma/login') return;
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
    saleDetailRoute,
    cashRoute,
    shiftRoute,
    cashSetupRoute,
    productsRoute,
    categoriesRoute,
    pricesRoute,
    stockRoute,
    movementsRoute,
    countsRoute,
    countDetailRoute,
    branchesRoute,
    employeesRoute,
    rolesRoute,
    auditRoute,
    settingsRoute,
    accountRoute,
  ]),
  platformLoginRoute,
  platformRoute.addChildren([platformIndexRoute, platformPlansRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
