import type { PermissionCode, TenantDto } from '@gc/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowUpRight, Boxes, Package, ShoppingCart, Wallet } from 'lucide-react';
import { Alert, Badge, Card, Spinner } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatCuit, TENANT_STATUS_LABELS } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

const SHORTCUTS = [
  { to: '/app/vender', title: 'Nueva venta', description: 'Al mostrador, sin vueltas.', icon: ShoppingCart, permissions: ['sales.create'] },
  { to: '/app/caja', title: 'Mi caja', description: 'Turnos, movimientos y cierre.', icon: Wallet, permissions: ['cash.open', 'cash.close', 'cash.count', 'cash.read_all'] },
  { to: '/app/productos', title: 'Productos', description: 'Tu catálogo, precios y códigos.', icon: Package, permissions: ['products.read'] },
  { to: '/app/stock', title: 'Inventario', description: 'Existencias y movimientos.', icon: Boxes, permissions: ['stock.read'] },
] satisfies { to: string; title: string; description: string; icon: typeof Boxes; permissions: PermissionCode[] }[];

function Usage({ label, used, limit }: { label: string; used: number; limit?: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-500">{label}</span>
        <span><span className="font-display text-xl font-semibold">{used}</span>{limit !== undefined && <span className="text-xs text-slate-500"> / {limit}</span>}</span>
      </div>
      {limit !== undefined && (
        <div className="mt-3 h-1 rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuenow={used} aria-valuemax={Math.max(used, limit)} aria-label={label}>
          <div className={`h-1 rounded-full ${pct >= 100 ? 'bg-orange-600' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function HomePage() {
  const me = useMe();
  const can = useCan();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant') });
  const shortcuts = SHORTCUTS.filter((item) => can(...item.permissions));
  const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Buenos_Aires' }).format(new Date());

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-5">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"><span className="size-1.5 rounded-full bg-brand-600" aria-hidden />Panel de tu comercio</p>
        <p className="text-xs text-slate-500 first-letter:uppercase">{date}</p>
      </div>
      <section className="mb-10 grid items-end gap-7 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="mb-3 text-sm text-slate-500">Hola, {me.user.name.split(' ')[0]}.</p>
          <h1 className="font-display text-4xl leading-[1.1] font-semibold tracking-[-0.045em] text-slate-900 sm:text-5xl lg:text-[3.5rem]">Todo listo para<br /><span className="text-brand-600">un buen día.</span></h1>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-slate-500 lg:mb-1 lg:ml-auto">Tu mostrador, tu caja y tus productos.<br />Elegí por dónde querés empezar.</p>
      </section>
      {shortcuts.length > 0 && (
        <section aria-label="Accesos rápidos" className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {shortcuts.map((item, index) => (
            <Link key={item.to} to={item.to} className={`group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-xl border p-4 transition-colors sm:min-h-48 sm:p-6 ${item.to === '/app/vender' ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-900' : 'border-slate-200 bg-white hover:border-brand-300'}`}>
              <div className="flex items-start justify-between"><item.icon className={`size-6 ${item.to === '/app/vender' ? 'text-brand-300' : 'text-slate-600'}`} aria-hidden /><span className="font-display text-[11px] text-slate-400">0{index + 1}</span></div>
              <div className="mt-7"><h2 className="flex items-center justify-between gap-2 font-display text-base font-semibold tracking-tight sm:text-lg">{item.title}<ArrowUpRight className="size-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden /></h2><p className={`mt-1 text-xs ${item.to === '/app/vender' ? 'text-slate-300' : 'text-slate-500'}`}>{item.description}</p></div>
            </Link>
          ))}
        </section>
      )}
      {tenant.isLoading && <Spinner />}
      {tenant.error && <Alert>{errorMessage(tenant.error)}</Alert>}
      {tenant.data && (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card className="p-6 sm:p-7">
            <div className="mb-6 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Tu comercio</h2><ArrowDownRight className="size-4 text-slate-400" aria-hidden /></div>
            <h3 className="font-display text-2xl font-semibold tracking-tight">{tenant.data.tradeName}</h3>
            <div className="mt-3"><Badge tone={tenant.data.status === 'active' ? 'green' : tenant.data.status === 'trial' ? 'brand' : 'slate'}>{TENANT_STATUS_LABELS[tenant.data.status] ?? tenant.data.status}</Badge></div>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 text-sm"><div><dt className="text-xs text-slate-500">CUIT</dt><dd className="mt-1 font-medium">{formatCuit(tenant.data.cuit) || 'Sin cargar'}</dd></div><div><dt className="text-xs text-slate-500">Tu rol</dt><dd className="mt-1 font-medium">{me.role?.name}</dd></div></dl>
            {can('settings.manage') && <Link to="/app/configuracion" className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-brand-700 hover:underline">Administrar comercio<ArrowUpRight className="size-3.5" aria-hidden /></Link>}
          </Card>
          <Card className="p-6 sm:p-7">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Tu plan</h2><span className="text-sm font-semibold text-slate-900">{tenant.data.plan?.name ?? 'Sin plan'}</span></div>
            <div className="space-y-6"><Usage label="Sucursales activas" used={tenant.data.usage.branches} limit={tenant.data.plan?.limits.max_branches} /><Usage label="Usuarios activos" used={tenant.data.usage.users} limit={tenant.data.plan?.limits.max_users} /></div>
            <p className="mt-7 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">¿Necesitás más capacidad? Consultá con la administración de la plataforma.</p>
          </Card>
        </div>
      )}
    </>
  );
}
