import type { PermissionCode } from '@gc/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Boxes, Building2, ClipboardList, CreditCard, History, Home, KeyRound, LogOut, Menu, Package, Percent, Receipt, Settings, ShieldCheck, ShoppingCart, Store, Tags, Users, Wallet } from 'lucide-react';
import { type ComponentType, Fragment, useState } from 'react';
import { Badge } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { TENANT_STATUS_LABELS } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  anyOf?: PermissionCode[];
}

/** Solo se muestran módulos implementados; cada fase agrega los suyos. */
const NAV: NavItem[] = [
  { to: '/app', label: 'Inicio', icon: Home },
  { to: '/app/vender', label: 'Vender', icon: ShoppingCart, anyOf: ['sales.create'] },
  { to: '/app/caja', label: 'Caja', icon: Wallet, anyOf: ['cash.open', 'cash.close', 'cash.count', 'cash.read_all'] },
  { to: '/app/ventas', label: 'Ventas', icon: Receipt, anyOf: ['sales.read_own', 'sales.read_all'] },
  { to: '/app/productos', label: 'Productos', icon: Package, anyOf: ['products.read'] },
  { to: '/app/categorias', label: 'Categorías y marcas', icon: Tags, anyOf: ['products.read'] },
  { to: '/app/precios', label: 'Cambio de precios', icon: Percent, anyOf: ['prices.bulk_update'] },
  { to: '/app/stock', label: 'Stock', icon: Boxes, anyOf: ['stock.read'] },
  { to: '/app/inventarios', label: 'Inventario físico', icon: ClipboardList, anyOf: ['stock.count'] },
  { to: '/app/sucursales', label: 'Sucursales', icon: Building2 },
  { to: '/app/empleados', label: 'Empleados', icon: Users, anyOf: ['users.manage'] },
  { to: '/app/roles', label: 'Roles y permisos', icon: ShieldCheck, anyOf: ['roles.manage'] },
  { to: '/app/auditoria', label: 'Auditoría', icon: History, anyOf: ['audit.read'] },
  { to: '/app/cajas', label: 'Cajas y medios de pago', icon: CreditCard, anyOf: ['branches.manage', 'settings.manage'] },
  { to: '/app/configuracion', label: 'Configuración', icon: Settings, anyOf: ['settings.manage'] },
  { to: '/app/cuenta', label: 'Mi cuenta', icon: KeyRound },
];

export function AppLayout() {
  const me = useMe();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((i) => !i.anyOf || can(...i.anyOf));
  const others = me.memberships.filter((m) => m.status === 'active' && m.tenantId !== me.tenant?.id);

  async function logout() {
    await http.post('/auth/logout').catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/login' });
  }

  async function switchTenant(tenantId: string) {
    try {
      await http.post('/auth/switch-tenant', { tenantId });
      queryClient.clear();
      await navigate({ to: '/app' });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <div className="flex min-h-full">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 transform flex-col border-r border-slate-200 bg-white transition-transform lg:sticky lg:top-0 lg:h-dvh lg:shrink-0 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Navegación principal"
      >
        <div className="flex h-20 shrink-0 items-center gap-3 px-5">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-10" />
          <div>
            <span className="block font-bold tracking-tight text-slate-900">Gestión Comercial</span>
            <span className="text-xs text-slate-500">Tu negocio, conectado</span>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {items.map((item) => (
            <Fragment key={item.to}>
              {['/app', '/app/productos', '/app/sucursales'].includes(item.to) && (
                <p className="px-3 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {item.to === '/app' ? 'Tu comercio' : item.to === '/app/productos' ? 'Catálogo e inventario' : 'Administración'}
                </p>
              )}
              <Link
                to={item.to}
                onClick={() => setOpen(false)}
                activeOptions={{ exact: item.to === '/app' }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                activeProps={{ className: 'bg-brand-50 !font-semibold !text-brand-700' }}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            </Fragment>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700" aria-hidden>{me.user.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-800">{me.user.name}</div>
            <div className="mt-0.5 truncate">{me.role?.name}</div>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-slate-900/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <button className="rounded-md p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
              <Menu className="size-5" />
            </button>
            <Store className="hidden size-5 text-slate-400 sm:block" aria-hidden />
            {others.length > 0 ? (
              <select
                aria-label="Comercio activo"
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium"
                value={me.tenant?.id ?? ''}
                onChange={(e) => void switchTenant(e.target.value)}
              >
                {me.tenant && <option value={me.tenant.id}>{me.tenant.tradeName}</option>}
                {others.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="max-w-[45vw] truncate text-base font-semibold sm:max-w-none">{me.tenant?.tradeName}</span>
            )}
            {me.tenant && me.tenant.status !== 'active' && (
              <Badge tone={me.tenant.status === 'trial' ? 'brand' : 'red'}>{TENANT_STATUS_LABELS[me.tenant.status] ?? me.tenant.status}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void logout()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <LogOut className="size-4" aria-hidden />
              Salir
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-9">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Pantalla cuando el usuario no tiene comercio activo o el comercio está suspendido. */
export function NoTenantPage({ reason }: { reason: 'none' | 'suspended' }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold">{reason === 'suspended' ? 'Comercio suspendido' : 'Sin comercio activo'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {reason === 'suspended'
            ? 'El acceso a este comercio está suspendido. Comunicate con soporte para regularizarlo.'
            : 'Tu usuario no pertenece a ningún comercio activo. Pedile al propietario que te habilite.'}
        </p>
        <button
          className="mt-6 text-sm text-brand-700 hover:underline"
          onClick={async () => {
            await http.post('/auth/logout').catch(() => undefined);
            queryClient.clear();
            await navigate({ to: '/login' });
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}

export function Forbidden() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      No tenés permiso para ver esta sección. Si lo necesitás, pedíselo al propietario del comercio.
    </div>
  );
}
