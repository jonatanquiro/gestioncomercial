import { BUSINESS_TYPES, type Paginated, type PlatformTenantDto, setTenantStatusSchema } from '@gc/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatCuit, formatDate, TENANT_STATUS_LABELS } from '@/lib/format';

const PAGE_SIZE = 25;
const BUSINESS_TYPE_NAMES = Object.fromEntries(BUSINESS_TYPES.map((b) => [b.code, b.name]));
const STATUS_TONE: Record<string, 'green' | 'brand' | 'amber' | 'red' | 'slate'> = {
  active: 'green',
  trial: 'brand',
  past_due: 'amber',
  suspended: 'red',
  cancelled: 'slate',
};

type FormIn = z.input<typeof setTenantStatusSchema>;
type FormOut = z.output<typeof setTenantStatusSchema>;

function StatusForm({ tenant, onDone }: { tenant: PlatformTenantDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const target = tenant.status === 'suspended' ? 'active' : 'suspended';
  const { register, handleSubmit, formState } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(setTenantStatusSchema),
    defaultValues: { status: target, reason: '' },
  });
  const save = useMutation({
    mutationFn: (v: FormOut) => http.post(`/platform/tenants/${tenant.id}/status`, v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      toast(target === 'suspended' ? 'Comercio suspendido' : 'Comercio habilitado');
      onDone();
    },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      <p className="text-sm text-slate-600">
        {target === 'suspended'
          ? 'Los usuarios del comercio no podrán operar hasta que se lo vuelva a habilitar. Sus datos se conservan.'
          : 'Los usuarios del comercio vuelven a tener acceso inmediatamente.'}
      </p>
      <Field label="Motivo" error={formState.errors.reason?.message} hint="Queda registrado en la auditoría de la plataforma.">
        {(p) => <Input {...p} autoFocus {...register('reason')} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant={target === 'suspended' ? 'danger' : 'primary'} loading={save.isPending}>
          {target === 'suspended' ? 'Suspender' : 'Habilitar'}
        </Button>
      </div>
    </form>
  );
}

export function PlatformTenantsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<PlatformTenantDto | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim()) params.set('q', search.trim());
  if (status) params.set('status', status);
  const query = useQuery({
    queryKey: ['platform-tenants', page, search.trim(), status],
    queryFn: () => http.get<Paginated<PlatformTenantDto>>(`/platform/tenants?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const pages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Comercios" description="Todos los comercios registrados, con su plan y uso actual." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar por nombre o CUIT"
          placeholder="Buscar por nombre o CUIT"
          className="sm:w-72"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Estado"
          className="sm:w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los estados</option>
          {Object.entries(TENANT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {query.isLoading && <Spinner />}
        {query.error && (
          <div className="p-4">
            <Alert>{errorMessage(query.error)}</Alert>
          </div>
        )}
        {query.data && query.data.items.length === 0 && <EmptyState>No hay comercios que coincidan.</EmptyState>}
        {query.data && query.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Comercio</Th>
                <Th>Rubro</Th>
                <Th>Plan</Th>
                <Th>Uso</Th>
                <Th>Estado</Th>
                <Th>Alta</Th>
                <Th className="text-right">Acciones</Th>
              </>
            }
          >
            {query.data.items.map((t) => (
              <tr key={t.id}>
                <Td>
                  <div className="font-medium">{t.tradeName}</div>
                  <div className="text-xs text-slate-500">{formatCuit(t.cuit) || 'Sin CUIT'}</div>
                </Td>
                <Td>{BUSINESS_TYPE_NAMES[t.businessTypeCode] ?? t.businessTypeCode}</Td>
                <Td>
                  {t.planCode ?? '—'}
                  {t.trialEndsAt && t.subscriptionStatus === 'trial' && (
                    <div className="text-xs text-slate-500">Prueba hasta {formatDate(t.trialEndsAt)}</div>
                  )}
                </Td>
                <Td className="text-slate-600">
                  {t.branchCount} suc. · {t.userCount} usu.
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[t.status] ?? 'slate'}>{TENANT_STATUS_LABELS[t.status] ?? t.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(t.createdAt)}</Td>
                <Td className="text-right">
                  {t.status !== 'cancelled' && (
                    <Button size="sm" variant={t.status === 'suspended' ? 'secondary' : 'ghost'} onClick={() => setEditing(t)}>
                      {t.status === 'suspended' ? 'Habilitar' : 'Suspender'}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {query.data && query.data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-600">
              Página {page} de {pages} · {query.data.total} comercios
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
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.status === 'suspended' ? `Habilitar ${editing.tradeName}` : `Suspender ${editing?.tradeName ?? ''}`}
      >
        {editing && <StatusForm tenant={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}
