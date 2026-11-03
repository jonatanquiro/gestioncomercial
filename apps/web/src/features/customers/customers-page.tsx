import { adjustAccountSchema, collectAccountSchema, CUSTOMER_DOCUMENT_TYPES, type CustomerDetailDto, type CustomerListDto, type SaleDto } from '@gc/contracts';
import { dec, formatArs, roundMoney } from '@gc/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid } from '@/features/catalog/queries';
import { paymentMethodsQuery, registersQuery } from '@/features/sales/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatCuit, formatDateTime, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { CustomerForm } from './customer-form';

const PAGE_SIZE = 25;
const MONEY = /^\d+(\.\d{1,2})?$/;

const MOVEMENT_LABELS = { sale: 'Compra a cuenta', payment: 'Pago', return: 'Devolución', void: 'Anulación', adjustment: 'Ajuste' } as const;

export const documentLabel = (type: number | null, number: string | null) =>
  type && number ? `${CUSTOMER_DOCUMENT_TYPES[type as keyof typeof CUSTOMER_DOCUMENT_TYPES]} ${type === 96 ? Number(number).toLocaleString('es-AR') : formatCuit(number)}` : null;

/** Saldo con signo legible: «debe» o «a favor». */
export function BalanceText({ balance }: { balance: string }) {
  if (dec(balance).isZero()) return <span className="text-slate-500">Sin saldo</span>;
  return dec(balance).gt(0) ? <span className="font-semibold text-red-700">Debe {formatArs(balance)}</span> : <span className="font-semibold text-emerald-700">A favor {formatArs(dec(balance).abs().toFixed(2))}</span>;
}

/** Clientes (ADR 0016): datos para facturarles y su cuenta corriente. */
export function CustomersPage() {
  const can = useCan();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [withDebt, setWithDebt] = useState(false);
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (withDebt) params.set('withDebt', 'true');
  const allowed = can('customers.manage', 'accounts.collect');
  const customers = useQuery({ queryKey: ['customers', params.toString()], queryFn: () => http.get<CustomerListDto>(`/customers?${params}`), placeholderData: keepPreviousData, enabled: allowed });

  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="Clientes"
        description="Datos para facturarles y cuenta corriente: lo que compran fiado y lo que pagan."
        actions={
          can('customers.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Nuevo cliente
            </Button>
          )
        }
      />
      {customers.data && dec(customers.data.receivable).gt(0) && (
        <Card className="mb-4 p-4">
          <p className="text-sm text-slate-600">Para cobrar en cuentas corrientes</p>
          <p className="font-display text-3xl font-bold tabular-nums">{formatArs(customers.data.receivable)}</p>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 p-4">
          <Input aria-label="Buscar cliente" placeholder="Nombre, documento o teléfono" className="w-72" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={withDebt} onChange={(e) => (setWithDebt(e.target.checked), setPage(1))} /> Solo los que deben
          </label>
        </div>
        {customers.isLoading && <Spinner />}
        {customers.error && <Alert>{errorMessage(customers.error)}</Alert>}
        {customers.data && customers.data.items.length === 0 && <EmptyState>{q || withDebt ? 'No hay clientes con esos filtros.' : 'Todavía no hay clientes cargados.'}</EmptyState>}
        {customers.data && customers.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Cliente</Th>
                <Th>Documento</Th>
                <Th>Teléfono</Th>
                <Th className="text-right">Límite</Th>
                <Th className="text-right">Saldo</Th>
              </>
            }
          >
            {customers.data.items.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link to="/app/clientes/$id" params={{ id: c.id }} className="-my-2 inline-flex min-h-10 items-center font-semibold text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                </Td>
                <Td>{documentLabel(c.documentType, c.documentNumber) ?? '—'}</Td>
                <Td>{c.phone ?? '—'}</Td>
                <Td className="text-right">{c.creditLimit === null ? '—' : formatArs(c.creditLimit)}</Td>
                <Td className="text-right">
                  <BalanceText balance={c.balance} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {customers.data && <Pager page={page} pageSize={PAGE_SIZE} total={customers.data.total} onPage={setPage} />}
      </Card>
      {creating && (
        <Dialog open onOpenChange={(o) => !o && setCreating(false)} title="Nuevo cliente" wide>
          <CustomerForm onDone={(saved) => (setCreating(false), void navigate({ to: '/app/clientes/$id', params: { id: saved.id } }))} />
        </Dialog>
      )}
    </>
  );
}

/** Ficha del cliente: datos, saldo y movimientos de la cuenta corriente. */
export function CustomerDetailPage() {
  const { id } = useParams({ from: '/app/clientes/$id' });
  const can = useCan();
  const customer = useQuery({ queryKey: ['customers', 'detail', id], queryFn: () => http.get<CustomerDetailDto>(`/customers/${id}`) });
  const [editing, setEditing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  if (!can('customers.manage', 'accounts.collect')) return <Forbidden />;
  if (customer.isLoading) return <Spinner />;
  if (customer.error) return <Alert>{errorMessage(customer.error)}</Alert>;
  const c = customer.data!;
  const details = [documentLabel(c.documentType, c.documentNumber), c.phone, c.email, c.address].filter(Boolean).join(' · ');
  return (
    <>
      <PageHeader
        title={c.name}
        description={details || undefined}
        actions={
          <>
            {can('accounts.collect') && dec(c.balance).gt(0) && <Button onClick={() => setCollecting(true)}>Cobrar</Button>}
            {can('accounts.grant_credit') && (
              <Button variant="secondary" onClick={() => setAdjusting(true)}>
                Ajustar saldo
              </Button>
            )}
            {can('customers.manage') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
          </>
        }
      />
      {c.status === 'inactive' && (
        <div className="mb-4">
          <Alert kind="info">El cliente está desactivado: no se le puede vender a su nombre.</Alert>
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm text-slate-600">Saldo de la cuenta</p>
          <p className="font-display text-3xl font-bold tabular-nums">
            <BalanceText balance={c.balance} />
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-slate-600">Límite de cuenta corriente</p>
          <p className="font-display text-3xl font-bold tabular-nums">{c.creditLimit === null ? 'No compra a cuenta' : formatArs(c.creditLimit)}</p>
          {c.creditLimit !== null && <p className="text-xs text-slate-500">Disponible: {formatArs(roundMoney(dec(c.creditLimit).minus(c.balance).gt(0) ? dec(c.creditLimit).minus(c.balance) : dec(0)))}</p>}
        </Card>
      </div>
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Movimientos</h2>
        {c.movements.length === 0 ? (
          <EmptyState>Todavía no compró a cuenta ni tiene movimientos.</EmptyState>
        ) : (
          <Table
            head={
              <>
                <Th>Fecha</Th>
                <Th>Movimiento</Th>
                <Th>Registró</Th>
                <Th className="text-right">Importe</Th>
                <Th className="text-right">Saldo</Th>
              </>
            }
          >
            {c.movements.map((m) => (
              <tr key={m.id}>
                <Td>{formatDateTime(m.createdAt)}</Td>
                <Td>
                  {MOVEMENT_LABELS[m.kind]}
                  {m.sale && (
                    <>
                      {' · '}
                      <Link to="/app/ventas/$id" params={{ id: m.sale.id }} className="font-semibold text-brand-700 hover:underline">
                        venta N° {m.sale.number}
                      </Link>
                    </>
                  )}
                  {m.notes && <span className="block text-xs text-slate-500">{m.notes}</span>}
                </Td>
                <Td>{m.userName}</Td>
                <Td className={`text-right font-semibold ${m.amount.startsWith('-') ? 'text-emerald-700' : 'text-red-700'}`}>{formatArs(m.amount)}</Td>
                <Td className="text-right">{formatArs(m.balanceAfter)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(false)} title="Editar cliente" wide>
          <CustomerForm customer={c} onDone={() => setEditing(false)} />
        </Dialog>
      )}
      {collecting && <CollectDialog customer={c} onClose={() => setCollecting(false)} />}
      {adjusting && <AdjustDialog customer={c} onClose={() => setAdjusting(false)} />}
    </>
  );
}

/** Cobro de la deuda: entra a la caja como cualquier venta, con el medio que sea. */
function CollectDialog({ customer, onClose }: { customer: CustomerDetailDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const registers = useQuery(registersQuery);
  const methods = useQuery(paymentMethodsQuery);
  const openRegisters = (registers.data ?? []).filter((r) => r.openShift);
  const activeMethods = (methods.data ?? []).filter((m) => m.active);
  const [clientUuid] = useState(newClientUuid);
  const [amount, setAmount] = useState(customer.balance.replace('.', ','));
  const [registerId, setRegisterId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const register = registerId || openRegisters[0]?.id || '';
  const method = activeMethods.find((m) => m.id === methodId) ?? activeMethods.find((m) => m.kind === 'cash') ?? activeMethods[0];
  const value = parseDecimalInput(amount);
  const isCash = method?.kind === 'cash';
  const paid = isCash && received.trim() ? parseDecimalInput(received) : value;
  const change = MONEY.test(value) && isCash && MONEY.test(paid) && dec(paid).gt(value) ? roundMoney(dec(paid).minus(value)) : '0.00';

  const collect = useMutation({
    mutationFn: (body: unknown) => http.post<SaleDto>(`/customers/${customer.id}/payments`, body),
    onSuccess: async (sale) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast(`Cobro registrado: venta N° ${sale.number}`);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR' ? (Object.values(err.fieldErrors())[0] ?? err.message) : errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (registers.isLoading || methods.isLoading) return;
    if (!register) return setError('Para cobrar tiene que haber una caja abierta');
    if (!method) return setError('No hay medios de pago activos');
    if (isCash && (!MONEY.test(paid) || (MONEY.test(value) && dec(paid).lt(value)))) return setError('El efectivo recibido no alcanza');
    if (method.requiresReference && !reference.trim()) return setError(`Cargá el número de operación de ${method.name}`);
    const parsed = collectAccountSchema.safeParse({ clientUuid, registerId: register, amount: value, payments: [{ paymentMethodId: method.id, amount: paid, reference: reference.trim() || null }] });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
    setError(null);
    collect.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !collect.isPending && onClose()} title={`Cobrar a ${customer.name}`} description={`Debe ${formatArs(customer.balance)}. Podés cobrar todo o una parte.`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Importe">{(p) => <Input {...p} autoFocus inputMode="decimal" className="h-12 text-right text-xl font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Cobra con">
            {(p) => (
              <Select {...p} className="h-12" value={method?.id ?? ''} onChange={(e) => (setMethodId(e.target.value), setReceived(''), setReference(''))}>
                {activeMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isCash && (
            <Field label="Recibido en efectivo" hint={dec(change).gt(0) ? `Vuelto ${formatArs(change)}` : undefined}>
              {(p) => <Input {...p} inputMode="decimal" placeholder={MONEY.test(value) ? value : ''} value={received} onChange={(e) => setReceived(e.target.value)} />}
            </Field>
          )}
          {method?.requiresReference && <Field label="N° de operación">{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>}
          <Field label="Caja">
            {(p) => (
              <Select {...p} value={register} onChange={(e) => setRegisterId(e.target.value)}>
                {openRegisters.length === 0 && <option value="">{registers.isLoading ? 'Cargando…' : 'No hay cajas abiertas'}</option>}
                {openRegisters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.branchName} · {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={collect.isPending}>
            Volver
          </Button>
          <Button type="submit" loading={collect.isPending || registers.isLoading || methods.isLoading}>
            Registrar cobro
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Saldo inicial al empezar a usar el sistema, o una corrección con motivo. */
function AdjustDialog({ customer, onClose }: { customer: CustomerDetailDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [direction, setDirection] = useState<'debt' | 'credit'>('debt');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const adjust = useMutation({
    mutationFn: (body: unknown) => http.post(`/customers/${customer.id}/adjustments`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast('Saldo ajustado');
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseDecimalInput(amount);
    const parsed = adjustAccountSchema.safeParse({ amount: direction === 'credit' ? `-${value}` : value, notes });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
    setError(null);
    adjust.mutate(parsed.data);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Ajustar saldo" description="Para cargar lo que ya debía antes de usar el sistema, o corregir un error. Queda registrado con el motivo.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            {(p) => (
              <Select {...p} value={direction} onChange={(e) => setDirection(e.target.value as 'debt' | 'credit')}>
                <option value="debt">Suma deuda</option>
                <option value="credit">Resta deuda o suma saldo a favor</option>
              </Select>
            )}
          </Field>
          <Field label="Importe">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        </div>
        <Field label="Motivo">{(p) => <Input {...p} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: saldo de la libreta al 1/11" />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" loading={adjust.isPending}>
            Guardar ajuste
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

