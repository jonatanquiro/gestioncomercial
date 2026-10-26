import type { PermissionCode, TenantDto } from '@gc/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Boxes, Building2, ChevronDown, ClipboardList, CreditCard, History, Home, KeyRound, LogOut, Menu, Package, Percent, Receipt, Settings, ShieldCheck, ShoppingCart, Store, Tags, Users, Wallet, X } from 'lucide-react';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { TENANT_STATUS_LABELS } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { appearanceStyle, DEFAULT_APPEARANCE } from '@/features/settings/appearance';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  anyOf?: PermissionCode[];
}

/** Las secciones agrupan solo funciones implementadas y respetan los permisos del usuario. */
const GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  { id: 'operacion', label: 'Operación', items: [
    { to: '/app/vender', label: 'Vender', icon: ShoppingCart, anyOf: ['sales.create'] },
    { to: '/app/caja', label: 'Caja', icon: Wallet, anyOf: ['cash.open', 'cash.close', 'cash.count', 'cash.read_all'] },
    { to: '/app/ventas', label: 'Ventas', icon: Receipt, anyOf: ['sales.read_own', 'sales.read_all'] },
    { to: '/app/rendiciones', label: 'Rendición de cobros', icon: ClipboardList, anyOf: ['cash.read_all'] },
  ] },
  { id: 'catalogo', label: 'Catálogo', items: [
    { to: '/app/productos', label: 'Productos', icon: Package, anyOf: ['products.read'] },
    { to: '/app/categorias', label: 'Categorías y marcas', icon: Tags, anyOf: ['products.read'] },
    { to: '/app/precios', label: 'Cambio de precios', icon: Percent, anyOf: ['prices.bulk_update'] },
  ] },
  { id: 'inventario', label: 'Inventario', items: [
    { to: '/app/stock', label: 'Stock', icon: Boxes, anyOf: ['stock.read'] },
    { to: '/app/inventarios', label: 'Inventario físico', icon: ClipboardList, anyOf: ['stock.count'] },
  ] },
  { id: 'administracion', label: 'Administración', items: [
    { to: '/app/sucursales', label: 'Sucursales', icon: Building2 },
    { to: '/app/empleados', label: 'Empleados', icon: Users, anyOf: ['users.manage'] },
    { to: '/app/roles', label: 'Roles y permisos', icon: ShieldCheck, anyOf: ['roles.manage'] },
    { to: '/app/auditoria', label: 'Auditoría', icon: History, anyOf: ['audit.read'] },
    { to: '/app/cajas', label: 'Cajas y medios de pago', icon: CreditCard, anyOf: ['branches.manage', 'settings.manage'] },
    { to: '/app/configuracion', label: 'Configuración', icon: Settings, anyOf: ['settings.manage'] },
    { to: '/app/apariencia', label: 'Apariencia', icon: Tags, anyOf: ['settings.manage'] },
    { to: '/app/facturacion', label: 'Facturación ARCA', icon: Receipt, anyOf: ['fiscal.manage'] },
    { to: '/app/cuenta', label: 'Mi cuenta', icon: KeyRound },
  ] },
];

export function AppLayout() {
  const me = useMe();
  const can = useCan();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const toast = useToast();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant') });
  const appearance = tenant.data?.appearance ?? DEFAULT_APPEARANCE;
  const [open, setOpen] = useState(false);
  const [dropdown, setDropdown] = useState<string | null>(null);
  const header = useRef<HTMLElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.anyOf || can(...i.anyOf)) })).filter((g) => g.items.length > 0);
  const others = me.memberships.filter((m) => m.status === 'active' && m.tenantId !== me.tenant?.id);

  useEffect(() => {
    const root = document.documentElement;
    const styles = appearanceStyle(appearance) as Record<string, string>;
    const previous = Object.fromEntries(Object.keys(styles).map(key => [key, root.style.getPropertyValue(key)]));
    const size = root.style.fontSize;
    const density = root.dataset.density;
    Object.entries(styles).forEach(([key, value]) => root.style.setProperty(key, value));
    root.style.fontSize = appearance.textSize === 'large' ? '18px' : '16px';
    root.dataset.density = appearance.density;
    return () => {
      Object.entries(previous).forEach(([key, value]) => value ? root.style.setProperty(key, value) : root.style.removeProperty(key));
      root.style.fontSize = size;
      if (density) root.dataset.density = density; else delete root.dataset.density;
    };
  }, [appearance]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!header.current?.contains(event.target as Node)) { setDropdown(null); setOpen(false); }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (dropdown) triggers.current[dropdown]?.focus();
        setDropdown(null);
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [dropdown]);

  function closeMenus() { setDropdown(null); setOpen(false); }

  async function logout() {
    await http.post('/auth/logout').catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/login' });
  }

  async function switchTenant(tenantId: string) {
    try {
      await http.post('/auth/switch-tenant', { tenantId });
      closeMenus();
      queryClient.clear();
      await navigate({ to: '/app' });
    } catch (err) { toast(errorMessage(err), 'error'); }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header ref={header} className="relative z-30">
        <div className="bg-slate-950 text-white">
          <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between gap-4 px-4 py-4 sm:px-8 lg:px-12">
            <Link to="/app" onClick={closeMenus} className="flex shrink-0 items-center gap-3" aria-label="Gestión Comercial, inicio">
              <img src={appearance.logoData || `${import.meta.env.BASE_URL}icon.svg`} alt="" className={appearance.logoData ? 'h-10 max-w-24 rounded object-contain' : 'size-9'} />
              <span className="font-display text-sm font-semibold leading-tight tracking-tight sm:text-base">Gestión<span className="block text-brand-300">Comercial.</span></span>
            </Link>
            <div className="ml-auto flex min-w-0 items-center gap-3 sm:ml-6 sm:mr-auto sm:border-l sm:border-white/15 sm:pl-6">
              <Store className="hidden size-4 shrink-0 text-brand-300 sm:block" aria-hidden />
              <div className="min-w-0">
                <p className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 sm:block">Tu espacio de trabajo</p>
                {others.length > 0 ? (
                  <select aria-label="Comercio activo" className="max-w-[35vw] rounded border border-white/20 bg-slate-900 px-2 py-1 text-sm text-white sm:max-w-72" value={me.tenant?.id ?? ''} onChange={(e) => void switchTenant(e.target.value)}>
                    {me.tenant && <option value={me.tenant.id}>{me.tenant.tradeName}</option>}
                    {others.map((m) => <option key={m.tenantId} value={m.tenantId}>{m.tenantName}</option>)}
                  </select>
                ) : <p className="max-w-[32vw] truncate text-sm font-medium sm:max-w-80">{me.tenant?.tradeName}</p>}
              </div>
              {me.tenant && me.tenant.status !== 'active' && <span className="hidden sm:block"><Badge tone={me.tenant.status === 'trial' ? 'brand' : 'red'}>{TENANT_STATUS_LABELS[me.tenant.status] ?? me.tenant.status}</Badge></span>}
            </div>
            <Link to="/app/cuenta" onClick={closeMenus} className="hidden items-center gap-3 rounded-lg px-2 py-1 hover:bg-white/5 sm:flex">
              <div className="text-right"><p className="text-sm font-medium">{me.user.name}</p><p className="text-xs text-slate-400">{me.role?.name}</p></div>
              <span className="flex size-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-sm text-brand-200" aria-hidden>{me.user.name.slice(0, 1).toUpperCase()}</span>
            </Link>
            <button onClick={() => void logout()} className="hidden rounded-lg p-2.5 text-slate-400 hover:bg-white/5 hover:text-white sm:block" aria-label="Salir"><LogOut className="size-4" /></button>
            <button className="shrink-0 rounded-lg border border-white/20 p-2 lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} aria-controls="mobile-navigation">
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {appearance.navigation === 'top' && <div data-tenant-menu className="hidden border-b border-slate-200 bg-white lg:block">
          <nav className="mx-auto flex max-w-[1440px] items-center gap-1 px-12" aria-label="Navegación principal">
            <Link to="/app" activeOptions={{ exact: true }} onClick={closeMenus} className="top-nav-link" activeProps={{ className: 'top-nav-active' }}><Home className="size-4" aria-hidden />Inicio</Link>
            {groups.map((group) => {
              const active = group.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
              return (
                <div key={group.id} className="relative">
                  <button ref={(node) => { triggers.current[group.id] = node; }} className={`top-nav-link ${active || dropdown === group.id ? 'top-nav-active' : ''}`} onClick={() => setDropdown(dropdown === group.id ? null : group.id)} aria-expanded={dropdown === group.id} aria-controls={`nav-${group.id}`}>
                    {group.label}<ChevronDown className={`size-3.5 transition-transform ${dropdown === group.id ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                  {dropdown === group.id && (
                    <div id={`nav-${group.id}`} className="absolute left-0 top-full z-40 w-64 rounded-b-xl border border-t-0 border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
                      {group.items.map((item) => <Link key={item.to} to={item.to} onClick={closeMenus} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900" activeProps={{ className: 'bg-brand-50 !text-brand-700' }}><item.icon className="size-4" />{item.label}</Link>)}
                    </div>
                  )}
                </div>
              );
            })}
            {can('sales.create') && <Link to="/app/vender" onClick={closeMenus} className="ml-auto flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><ShoppingCart className="size-4" aria-hidden />Nueva venta</Link>}
          </nav>
        </div>}
        {open && (
          <nav data-tenant-menu id="mobile-navigation" className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-b border-slate-200 bg-white p-4 shadow-xl lg:hidden" aria-label="Navegación móvil">
            <Link to="/app" activeOptions={{ exact: true }} onClick={closeMenus} className="flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-semibold" activeProps={{ className: 'bg-brand-50 text-brand-700' }}><Home className="size-4" />Inicio</Link>
            {groups.map((group) => <div key={group.id} className="mt-4 border-t border-slate-100 pt-3"><p className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">{group.label}</p><div className="mt-2 grid gap-1 sm:grid-cols-2">{group.items.map((item) => <Link key={item.to} to={item.to} onClick={closeMenus} className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-600 hover:bg-slate-50" activeProps={{ className: 'bg-brand-50 !text-brand-700' }}><item.icon className="size-4" />{item.label}</Link>)}</div></div>)}
            <button onClick={() => void logout()} className="mt-4 flex items-center gap-3 px-3 py-3 text-sm text-slate-600"><LogOut className="size-4" />Salir</button>
          </nav>
        )}
      </header>
      <div className="flex min-w-0 flex-1">
        {appearance.navigation === 'side' && <aside data-tenant-menu className="sticky top-0 hidden max-h-dvh w-60 shrink-0 self-start overflow-y-auto border-r border-slate-200 px-3 pb-6 pt-4 lg:block" aria-label="Navegación principal">
          <Link to="/app" activeOptions={{ exact: true }} className="side-nav-link" activeProps={{ className: 'side-nav-active' }}><Home className="size-4" />Inicio</Link>
          {groups.map(group => <div key={group.id} className="mt-5"><p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest">{group.label}</p>{group.items.map(item => <Link key={item.to} to={item.to} className="side-nav-link" activeProps={{ className: 'side-nav-active' }}><item.icon className="size-4 shrink-0" />{item.label}</Link>)}</div>)}
        </aside>}
        <main className={`mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-4 py-7 sm:px-8 sm:py-9 ${appearance.navigation === 'top' ? 'lg:px-12' : 'lg:px-8'} lg:py-10`}><Outlet /></main>
      </div>
      <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap justify-between gap-2 px-4 pb-5 pt-8 text-[11px] text-slate-500 sm:px-8 lg:px-12"><span>Gestión Comercial · Hecho para tu negocio</span><span>{me.tenant?.tradeName}</span></footer>
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
