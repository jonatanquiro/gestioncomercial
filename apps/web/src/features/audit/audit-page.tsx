import type { AuditEntryDto, Paginated } from '@gc/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const ACTION_LABELS: Record<string, string> = {
  'tenant.created': 'Alta del comercio',
  'tenant.updated': 'Cambio de datos del comercio',
  'auth.login': 'Inicio de sesión',
  'auth.tenant_selected': 'Cambio de comercio activo',
  'branch.created': 'Alta de sucursal',
  'branch.updated': 'Cambio de sucursal',
  'role.created': 'Alta de rol',
  'role.updated': 'Cambio de rol',
  'role.deleted': 'Baja de rol',
  'membership.created': 'Alta de empleado',
  'membership.updated': 'Cambio de empleado',
  'platform.tenant_suspended': 'Suspensión por la plataforma',
  'platform.tenant_activated': 'Habilitación por la plataforma',
  'product.created': 'Alta de producto',
  'product.updated': 'Cambio de producto',
  'product.deactivated': 'Desactivación de producto',
  'product.activated': 'Reactivación de producto',
  'category.created': 'Alta de categoría',
  'category.updated': 'Cambio de categoría',
  'brand.created': 'Alta de marca',
  'stock.adjusted': 'Ajuste de stock',
  'stock.wasted': 'Baja de stock por merma o vencimiento',
  'stock_count.opened': 'Inicio de inventario físico',
  'stock_count.closed': 'Cierre de inventario físico',
  'stock_count.cancelled': 'Cancelación de inventario físico',
  'prices.bulk_updated': 'Cambio masivo de precios',
};

const ENTITY_OPTIONS = [
  ['', 'Todas'],
  ['tenant', 'Comercio'],
  ['branch', 'Sucursales'],
  ['role', 'Roles'],
  ['membership', 'Empleados'],
  ['session', 'Sesiones'],
  ['product', 'Productos'],
  ['category', 'Categorías'],
  ['warehouse', 'Stock'],
  ['stock_count', 'Inventario físico'],
  ['price_change_batch', 'Cambios de precios'],
] as const;

const PAGE_SIZE = 25;

export function AuditPage() {
  const can = useCan();
  const allowed = can('audit.read');
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['audit', page, entityType],
    queryFn: () => http.get<Paginated<AuditEntryDto>>(`/audit?page=${page}&pageSize=${PAGE_SIZE}${entityType ? `&entityType=${entityType}` : ''}`),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  if (!allowed) return <Forbidden />;
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Auditoría" description="Registro inalterable de las acciones sensibles del comercio." />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="audit-entity" className="text-sm text-slate-600">
          Entidad
        </label>
        <Select
          id="audit-entity"
          className="sm:w-48"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setPage(1);
          }}
        >
          {ENTITY_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {query.isLoading && <Spinner />}
        {query.error && <div className="p-4"><Alert>{errorMessage(query.error)}</Alert></div>}
        {query.data && query.data.items.length === 0 && <EmptyState>Sin registros.</EmptyState>}
        {query.data && query.data.items.length > 0 && (
          <Table head={<><Th>Fecha</Th><Th>Usuario</Th><Th>Acción</Th><Th>IP</Th><Th className="text-right">Detalle</Th></>}>
            {query.data.items.map((i) => (
              <Fragment key={i.id}>
                <tr>
                  <Td className="whitespace-nowrap">{formatDateTime(i.at)}</Td>
                  <Td>{i.actorName ?? 'Sistema'}</Td>
                  <Td>{ACTION_LABELS[i.action] ?? i.action}</Td>
                  <Td className="text-slate-500">{i.ip ?? '—'}</Td>
                  <Td className="text-right">
                    {(i.before !== null || i.after !== null) && (
                      <Button size="sm" variant="ghost" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>
                        {open === i.id ? 'Ocultar' : 'Ver'}
                      </Button>
                    )}
                  </Td>
                </tr>
                {open === i.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-4 py-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Antes</div>
                          <pre className="overflow-x-auto rounded bg-white p-2 text-xs">{JSON.stringify(i.before, null, 2) ?? '—'}</pre>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Después</div>
                          <pre className="overflow-x-auto rounded bg-white p-2 text-xs">{JSON.stringify(i.after, null, 2) ?? '—'}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
        {query.data && query.data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-600">
              Página {page} de {pages} · {query.data.total} registros
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
