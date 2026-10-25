import { type Paginated, type PermissionCode, type SaleDto, type SaleSummaryDto } from '@gc/contracts';
import { dec, formatArs, proportionalAmount, roundMoney, sumMoney } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid, tenantQuery } from '@/features/catalog/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatDateTime, formatQty, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PinDialog } from './pin-dialog';
import { type Authorization, needsAuthorization, paymentMethodsQuery, registersQuery } from './queries';
import { PrintTicket } from './ticket';

const PAGE_SIZE = 25;

export function SalesPage() {
  const can = useCan();
  const allowed = can('sales.read_own', 'sales.read_all');
  const [page, setPage] = useState(1);
  const [number, setNumber] = useState('');
  const [day, setDay] = useState('');
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (/^\d+$/.test(number.trim())) params.set('number', number.trim());
  if (day) (params.set('from', day), params.set('to', day));
  const sales = useQuery({ queryKey: ['sales', params.toString()], queryFn: () => http.get<Paginated<SaleSummaryDto>>(`/sales?${params}`), enabled: allowed });

  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="Ventas"
        description={can('sales.read_all') ? 'Todas las ventas del comercio.' : 'Las ventas que cobraste vos.'}
        actions={
          can('sales.create') ? (
            <Link to="/app/vender" className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
              Vender
            </Link>
          ) : undefined
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <Input aria-label="Número de venta" placeholder="N° de venta" className="w-40" inputMode="numeric" value={number} onChange={(e) => (setNumber(e.target.value), setPage(1))} />
          <Input aria-label="Día" type="date" className="w-48" value={day} onChange={(e) => (setDay(e.target.value), setPage(1))} />
        </div>
        {sales.isLoading && <Spinner />}
        {sales.error && <Alert>{errorMessage(sales.error)}</Alert>}
        {sales.data && sales.data.items.length === 0 && <EmptyState>No hay ventas con esos filtros.</EmptyState>}
        {sales.data && sales.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>N°</Th>
                <Th>Fecha</Th>
                <Th>Caja</Th>
                <Th>Atendió</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
              </>
            }
          >
            {sales.data.items.map((s) => (
              <tr key={s.id}>
                <Td>
                  <Link to="/app/ventas/$id" params={{ id: s.id }} className="font-semibold text-brand-700 hover:underline">
                    {s.number}
                  </Link>
                </Td>
                <Td>{formatDateTime(s.confirmedAt)}</Td>
                <Td>{s.registerName}</Td>
                <Td>{s.cashierName}</Td>
                <Td className="text-right font-semibold">{formatArs(s.total)}</Td>
                <Td>
                  {s.status === 'voided' ? (
                    <Badge tone="red">Anulada</Badge>
                  ) : dec(s.returnedTotal).gt(0) ? (
                    <Badge tone="amber">Devolución {formatArs(s.returnedTotal)}</Badge>
                  ) : (
                    <Badge tone="green">Cobrada</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {sales.data && <Pager page={page} pageSize={PAGE_SIZE} total={sales.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function SaleDetailPage() {
  const { id } = useParams({ from: '/app/ventas/$id' });
  const can = useCan();
  const sale = useQuery({ queryKey: ['sales', 'detail', id], queryFn: () => http.get<SaleDto>(`/sales/${id}`) });
  const tenant = useQuery(tenantQuery);
  const [printing, setPrinting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);

  if (!can('sales.read_own', 'sales.read_all')) return <Forbidden />;
  if (sale.isLoading) return <Spinner />;
  if (sale.error) return <Alert>{errorMessage(sale.error)}</Alert>;
  const s = sale.data!;
  const returnable = s.lines.some((l) => dec(l.quantity).gt(l.returnedQuantity));

  return (
    <>
      <PageHeader
        title={`Venta N° ${s.number}`}
        description={`${formatDateTime(s.confirmedAt)} · ${s.branchName} · ${s.registerName} · Atendió ${s.cashierName}`}
        actions={
          <>
            <Button variant="secondary" disabled={!tenant.data} onClick={() => setPrinting(true)}>
              <Printer className="size-4" /> Reimprimir ticket
            </Button>
            {s.status === 'confirmed' && can('sales.create', 'sales.return') && returnable && (
              <Button variant="secondary" onClick={() => setReturning(true)}>
                Devolución
              </Button>
            )}
            {s.status === 'confirmed' && s.returns.length === 0 && can('sales.create', 'sales.void') && (
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Anular
              </Button>
            )}
          </>
        }
      />
      {s.void && (
        <div className="mb-4">
          <Alert>
            Anulada el {formatDateTime(s.void.at)} por {s.void.byName}
            {s.void.authorizedByName && `, autorizó ${s.void.authorizedByName}`}. Motivo: {s.void.reason}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <Table
            head={
              <>
                <Th>Artículo</Th>
                <Th className="text-right">Cantidad</Th>
                <Th className="text-right">Precio</Th>
                <Th className="text-right">Desc.</Th>
                <Th className="text-right">Importe</Th>
                <Th className="text-right">Devuelto</Th>
              </>
            }
          >
            {s.lines.map((l) => (
              <tr key={l.id}>
                <Td className="font-medium">{l.description}</Td>
                <Td className="text-right">{formatQty(l.quantity, l.saleMode)}</Td>
                <Td className="text-right">{formatArs(l.unitPrice)}</Td>
                <Td className="text-right">{l.discountPercent === '0.00' ? '—' : `${l.discountPercent.replace('.', ',')} %`}</Td>
                <Td className="text-right font-semibold">{formatArs(l.total)}</Td>
                <Td className="text-right">{dec(l.returnedQuantity).gt(0) ? formatQty(l.returnedQuantity, l.saleMode) : '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card className="h-fit space-y-2 p-5 text-sm">
          {s.discountTotal !== '0.00' && (
            <>
              <Line label="Subtotal" value={formatArs(s.subtotal)} />
              <Line label={`Descuentos${s.discountAuthorizedBy ? ` (autorizó ${s.discountAuthorizedBy})` : ''}`} value={`−${formatArs(s.discountTotal)}`} />
            </>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatArs(s.total)}</span>
          </div>
          {s.payments.map((p, i) => (
            <Line key={i} label={`${p.name}${p.reference ? ` · ${p.reference}` : ''}`} value={formatArs(p.amount)} />
          ))}
          {s.changeGiven !== '0.00' && <Line label="Vuelto entregado" value={formatArs(s.changeGiven)} />}
        </Card>
      </div>
      {s.returns.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Devoluciones</h2>
          <Table
            head={
              <>
                <Th>N°</Th>
                <Th>Fecha</Th>
                <Th>Motivo</Th>
                <Th>Reintegro</Th>
                <Th>Registró</Th>
                <Th className="text-right">Importe</Th>
              </>
            }
          >
            {s.returns.map((r) => (
              <tr key={r.id}>
                <Td>{r.number}</Td>
                <Td>{formatDateTime(r.createdAt)}</Td>
                <Td>{r.reason}</Td>
                <Td>{r.paymentMethodName}</Td>
                <Td>
                  {r.userName}
                  {r.authorizedByName && <span className="block text-xs text-slate-500">Autorizó {r.authorizedByName}</span>}
                </Td>
                <Td className="text-right font-semibold">{formatArs(r.total)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {voiding && <VoidDialog sale={s} onClose={() => setVoiding(false)} />}
      {returning && <ReturnDialog sale={s} onClose={() => setReturning(false)} />}
      {printing && tenant.data && <PrintTicket sale={s} tenant={tenant.data} onDone={() => setPrinting(false)} />}
    </>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-slate-600">{label}</span>
    <span>{value}</span>
  </div>
);

/** Repite el pedido con el PIN de un encargado cuando el servidor lo pide. */
function useAuthorized<T>(send: (a: Authorization) => Promise<T>, onSuccess: (r: T) => void) {
  const [pin, setPin] = useState<{ permission: PermissionCode; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: send,
    onSuccess: (r) => (setPin(null), onSuccess(r)),
    onError: (err) => {
      const permission = needsAuthorization(err);
      if (permission) return setPin({ permission, error: err instanceof ApiRequestError && err.code === 'AUTHORIZATION_INVALID' ? err.message : null });
      setPin(null);
      setError(err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR' ? Object.values(err.fieldErrors())[0] ?? err.message : errorMessage(err));
    },
  });
  const dialog = (
    <PinDialog permission={pin?.permission ?? null} error={pin?.error ?? null} loading={mutation.isPending} onAuthorize={(a) => mutation.mutate(a)} onCancel={() => setPin(null)} />
  );
  return { mutation, error, setError, dialog, waitingPin: pin !== null };
}

function VoidDialog({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const { mutation, error, setError, dialog, waitingPin } = useAuthorized(
    (authorization) => http.post<SaleDto>(`/sales/${sale.id}/void`, { reason: reason.trim(), authorization }),
    async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast(`Venta N° ${sale.number} anulada`);
      onClose();
    },
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError('Escribí el motivo');
    setError(null);
    mutation.mutate(null);
  }
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title={`Anular la venta N° ${sale.number}`} description="El stock vuelve al depósito y el efectivo sale de la caja. Solo se puede anular dentro del mismo turno.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Motivo">{(p) => <Input {...p} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={mutation.isPending && !waitingPin}>
              Anular venta
            </Button>
          </div>
        </form>
      </Dialog>
      {dialog}
    </>
  );
}

function ReturnDialog({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const registers = useQuery(registersQuery);
  const methods = useQuery(paymentMethodsQuery);
  const openRegisters = (registers.data ?? []).filter((r) => r.openShift);
  const [registerId, setRegisterId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [reason, setReason] = useState('');
  const [clientUuid] = useState(newClientUuid);
  const pending = sale.lines.filter((l) => dec(l.quantity).gt(l.returnedQuantity));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const register = registerId || (openRegisters.find((r) => r.id === sale.registerId) ?? openRegisters[0])?.id || '';
  const activeMethods = (methods.data ?? []).filter((m) => m.active);
  const method = methodId || activeMethods.find((m) => m.kind === 'cash')?.id || activeMethods[0]?.id || '';

  const lines = pending
    .map((l) => {
      const q = parseDecimalInput(qty[l.id] ?? '');
      const remaining = dec(l.quantity).minus(l.returnedQuantity);
      const valid = /^\d+(\.\d{1,3})?$/.test(q) && dec(q).gt(0) && dec(q).lte(remaining);
      const returnedAmount = sumMoney(sale.returns.flatMap((r) => r.lines.filter((x) => x.saleLineId === l.id).map((x) => x.amount)));
      const amount = valid ? (dec(q).eq(remaining) ? roundMoney(dec(l.total).minus(returnedAmount)) : proportionalAmount(l.total, q, l.quantity)) : '0.00';
      return { line: l, q, valid, typed: (qty[l.id] ?? '').trim() !== '', amount, remaining };
    })
    .filter((x) => x.typed);
  const total = sumMoney(lines.map((l) => l.amount));

  const { mutation, error, setError, dialog, waitingPin } = useAuthorized(
    (authorization) =>
      http.post<SaleDto>(`/sales/${sale.id}/returns`, {
        clientUuid,
        registerId: register,
        reason: reason.trim(),
        paymentMethodId: method,
        lines: lines.map((l) => ({ saleLineId: l.line.id, quantity: l.q, restock: restock[l.line.id] ?? true })),
        authorization,
      }),
    async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(`Devolución registrada: ${formatArs(total)}`);
      onClose();
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return setError('Indicá cuánto se devuelve de cada artículo');
    if (lines.some((l) => !l.valid)) return setError('Revisá las cantidades: no pueden superar lo que queda por devolver');
    if (!reason.trim()) return setError('Escribí el motivo');
    if (!register) return setError('Para devolver tiene que haber una caja abierta');
    setError(null);
    mutation.mutate(null);
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title={`Devolución de la venta N° ${sale.number}`} wide>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Artículo</th>
                  <th className="py-2 text-right">Queda</th>
                  <th className="w-28 py-2">Devuelve</th>
                  <th className="py-2">Vuelve al stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-medium">{l.description}</td>
                    <td className="py-2 text-right">{formatQty(roundQty(dec(l.quantity).minus(l.returnedQuantity)), l.saleMode)}</td>
                    <td className="py-2 pl-3">
                      <Input aria-label={`Cantidad que devuelve de ${l.description}`} inputMode="decimal" className="h-9 text-right" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                    </td>
                    <td className="py-2 pl-3">
                      <input
                        type="checkbox"
                        aria-label={`${l.description} vuelve al stock`}
                        className="size-4"
                        checked={restock[l.id] ?? true}
                        onChange={(e) => setRestock({ ...restock, [l.id]: e.target.checked })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Motivo">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
            <Field label="Se reintegra en">
              {(p) => (
                <Select {...p} value={method} onChange={(e) => setMethodId(e.target.value)}>
                  {activeMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Caja">
              {(p) => (
                <Select {...p} value={register} onChange={(e) => setRegisterId(e.target.value)}>
                  {openRegisters.length === 0 && <option value="">No hay cajas abiertas</option>}
                  {openRegisters.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.branchName} · {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg">
              A devolver: <span className="font-bold">{formatArs(total)}</span>
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Volver
              </Button>
              <Button type="submit" loading={mutation.isPending && !waitingPin}>
                Registrar devolución
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
      {dialog}
    </>
  );
}

const roundQty = (v: ReturnType<typeof dec>) => v.toFixed(3);
