import type { TenantDto } from '@gc/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatCuit, TENANT_STATUS_LABELS } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

function Usage({ label, used, limit }: { label: string; used: number; limit?: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-slate-600">{label}</span>
        <span>
          <span className="text-2xl font-semibold">{used}</span>
          {limit !== undefined && <span className="text-sm text-slate-500"> de {limit}</span>}
        </span>
      </div>
      {limit !== undefined && (
        <div className="mt-1 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={used} aria-valuemax={limit} aria-label={label}>
          <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-orange-600' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function HomePage() {
  const me = useMe();
  const can = useCan();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant') });

  return (
    <>
      <PageHeader title={`Hola, ${me.user.name.split(' ')[0]}`} description="Resumen de tu comercio." />
      {tenant.isLoading && <Spinner />}
      {tenant.error && <Alert>{errorMessage(tenant.error)}</Alert>}
      {tenant.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl bg-slate-900 p-6 text-slate-300">
            <div className="text-xs font-semibold tracking-wider text-brand-400 uppercase">Tu comercio</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{tenant.data.tradeName}</h2>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <dt className="text-slate-500">Estado</dt>
              <dd className="text-white">{TENANT_STATUS_LABELS[tenant.data.status] ?? tenant.data.status}</dd>
              <dt className="text-slate-500">CUIT</dt>
              <dd className="text-white">{formatCuit(tenant.data.cuit) || 'Sin cargar'}</dd>
              <dt className="text-slate-500">Tu rol</dt>
              <dd className="text-white">{me.role?.name}</dd>
            </dl>
            {can('settings.manage') && (
              <Link to="/app/configuracion" className="mt-5 inline-block text-sm font-medium text-brand-300 hover:underline">
                Editar datos del comercio
              </Link>
            )}
          </div>
          <Card className="p-6">
            <h2 className="font-semibold">Plan {tenant.data.plan?.name ?? '—'}</h2>
            <div className="mt-4 space-y-4">
              <Usage label="Sucursales activas" used={tenant.data.usage.branches} limit={tenant.data.plan?.limits.max_branches} />
              <Usage label="Usuarios activos" used={tenant.data.usage.users} limit={tenant.data.plan?.limits.max_users} />
            </div>
          </Card>
          <Card className="p-6 lg:col-span-2">
            <h2 className="font-semibold">Próximos módulos</h2>
            <p className="mt-2 text-sm text-slate-600">
              Ya podés cargar productos y controlar el stock. El punto de venta, la caja, las compras y la facturación electrónica se habilitan en las
              próximas etapas.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
