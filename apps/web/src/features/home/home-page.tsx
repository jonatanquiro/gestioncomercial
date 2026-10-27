import type { PermissionCode, TenantDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, Boxes, Package, Receipt, ShoppingCart, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Card } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';

type Today = {
  date: string;
  sales?: { scope: 'all' | 'own'; count: number; total: string; cash: string; electronic: string };
  cash?: { openShifts: number; expected: string };
  payments?: { unsettledCount: number; unsettledAmount: string; missingReference: number };
  stock?: { lowCount: number; lowNames: string[] };
};

const SHORTCUTS = [
  { to: '/app/caja', title: 'Caja', icon: Wallet, permissions: ['cash.open', 'cash.close', 'cash.count', 'cash.read_all'] },
  { to: '/app/ventas', title: 'Ventas', icon: Receipt, permissions: ['sales.read_own', 'sales.read_all'] },
  { to: '/app/productos', title: 'Productos', icon: Package, permissions: ['products.read'] },
  { to: '/app/stock', title: 'Stock', icon: Boxes, permissions: ['stock.read'] },
] satisfies { to: string; title: string; icon: typeof Boxes; permissions: PermissionCode[] }[];

/** Tarjeta tipo ticket: título, número grande y detalle debajo del corte. */
function TicketStat({ label, value, detail, to, tone }: { label: string; value: ReactNode; detail: ReactNode; to?: string; tone?: 'alert' }) {
  const body = (
    <>
      <div className="p-5 pb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className={`mt-2 font-display text-3xl font-bold tabular-nums ${tone === 'alert' ? 'text-brand-700' : 'text-slate-900'}`}>{value}</p>
      </div>
      <div className="ticket-cut flex items-center justify-between gap-2 px-5 py-3 text-xs text-slate-600">
        <span className="min-w-0">{detail}</span>
        {to && <ArrowRight className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="ticket group block transition-colors hover:border-brand-300">
      {body}
    </Link>
  ) : (
    <div className="ticket">{body}</div>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit?: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold">
          {used}
          {limit !== undefined && <span className="font-normal text-slate-500"> de {limit}</span>}
        </span>
      </div>
      {limit !== undefined && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuenow={used} aria-valuemax={Math.max(used, limit)} aria-label={label}>
          <div className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-brand-600' : 'bg-almacen-700'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function HomePage() {
  const me = useMe();
  const can = useCan();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant') });
  const canSeeToday = can('sales.read_own', 'sales.read_all', 'cash.read_all', 'stock.read');
  const today = useQuery({ queryKey: ['dashboard', 'today'], queryFn: () => http.get<Today>('/dashboard/today'), enabled: canSeeToday, refetchInterval: 60_000 });
  const shortcuts = SHORTCUTS.filter((item) => can(...item.permissions));
  const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Buenos_Aires' }).format(new Date());
  const t = today.data;

  return (
    <>
      <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500 first-letter:uppercase">{date}</p>
          <h1 className="mt-1 font-display text-4xl font-bold text-slate-900 sm:text-5xl">Hola, {me.user.name.split(' ')[0]}.</h1>
        </div>
        {can('sales.create') && (
          <Link to="/app/vender" className="group inline-flex h-16 items-center gap-3 rounded-2xl bg-brand-600 px-7 font-display text-xl font-bold text-white shadow-sm transition-colors hover:bg-brand-700">
            <ShoppingCart className="size-6" aria-hidden />
            Nueva venta
            <ArrowUpRight className="size-5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </section>

      {today.error && (
        <div className="mb-6">
          <Alert>{errorMessage(today.error)}</Alert>
        </div>
      )}
      {t && (
        <section aria-label="Resumen de hoy" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {t.sales && (
            <TicketStat
              label={t.sales.scope === 'all' ? 'Vendido hoy' : 'Vendiste hoy'}
              value={formatArs(t.sales.total)}
              to="/app/ventas"
              detail={
                <>
                  {t.sales.count === 1 ? '1 venta' : `${t.sales.count} ventas`} · efectivo {formatArs(t.sales.cash)} · otros {formatArs(t.sales.electronic)}
                </>
              }
            />
          )}
          {t.cash && <TicketStat label="Efectivo en caja" value={formatArs(t.cash.expected)} to="/app/caja" detail={t.cash.openShifts === 0 ? 'No hay cajas abiertas' : t.cash.openShifts === 1 ? '1 caja abierta · según el sistema' : `${t.cash.openShifts} cajas abiertas · según el sistema`} />}
          {t.payments && (
            <TicketStat
              label="Cobros sin rendir"
              value={t.payments.unsettledCount}
              tone={t.payments.missingReference > 0 ? 'alert' : undefined}
              to="/app/cobros"
              detail={
                <>
                  {formatArs(t.payments.unsettledAmount)} en transferencias, QR y tarjetas
                  {t.payments.missingReference > 0 && <span className="font-semibold text-brand-700"> · {t.payments.missingReference} sin N° de operación</span>}
                </>
              }
            />
          )}
          {t.stock && (
            <TicketStat
              label="Stock bajo el mínimo"
              value={t.stock.lowCount}
              tone={t.stock.lowCount > 0 ? 'alert' : undefined}
              to="/app/stock"
              detail={t.stock.lowCount === 0 ? 'Todo en orden' : `${t.stock.lowNames.join(', ')}${t.stock.lowCount > t.stock.lowNames.length ? ` y ${t.stock.lowCount - t.stock.lowNames.length} más` : ''}`}
            />
          )}
        </section>
      )}

      {shortcuts.length > 0 && (
        <section aria-label="Accesos rápidos" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {shortcuts.map((item) => (
            <Link key={item.to} to={item.to} className="group flex h-16 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 font-semibold shadow-xs transition-colors hover:border-brand-300">
              <span className="flex size-9 items-center justify-center rounded-xl bg-almacen-700 text-white">
                <item.icon className="size-5" aria-hidden />
              </span>
              {item.title}
              <ArrowRight className="ml-auto size-4 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ))}
        </section>
      )}

      {tenant.data?.plan && (
        <Card className="max-w-xl p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Tu plan</h2>
            <span className="text-sm font-semibold">{tenant.data.plan.name}</span>
          </div>
          <div className="space-y-4">
            <Usage label="Sucursales activas" used={tenant.data.usage.branches} limit={tenant.data.plan.limits.max_branches} />
            <Usage label="Usuarios activos" used={tenant.data.usage.users} limit={tenant.data.plan.limits.max_users} />
          </div>
        </Card>
      )}
    </>
  );
}
