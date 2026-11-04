import { adjustAccountSchema, SUPPLIER_PAYMENT_METHODS, type SupplierDetailDto, supplierPaymentSchema } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid } from '@/features/catalog/queries';
import { registersQuery } from '@/features/sales/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatCuit, formatDateTime, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';

const KIND_LABELS = { purchase: 'Compra', payment: 'Pago', adjustment: 'Ajuste' } as const;

/** Saldo con un proveedor: lo que se le debe o lo pagado por adelantado. */
export function SupplierBalance({ balance }: { balance: string }) {
  if (dec(balance).isZero()) return <span className="text-slate-500">Al día</span>;
  return dec(balance).gt(0) ? <span className="font-semibold text-red-700">Se le debe {formatArs(balance)}</span> : <span className="font-semibold text-emerald-700">A favor {formatArs(dec(balance).abs().toFixed(2))}</span>;
}

/** Ficha del proveedor: saldo, compras a pagar y pagos (ADR 0018). */
export function SupplierDetailPage() {
  const { id } = useParams({ from: '/app/compras/proveedores/$id' });
  const can = useCan();
  const supplier = useQuery({ queryKey: ['suppliers', 'detail', id], queryFn: () => http.get<SupplierDetailDto>(`/suppliers/${id}`) });
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  if (!can('suppliers.manage', 'purchases.create', 'purchases.pay')) return <Forbidden />;
  if (supplier.isLoading) return <Spinner />;
  if (supplier.error) return <Alert>{errorMessage(supplier.error)}</Alert>;
  const s = supplier.data!;
  return (
    <>
      <PageHeader
        title={s.name}
        description={[s.cuit && `CUIT ${formatCuit(s.cuit)}`, s.phone, s.email].filter(Boolean).join(' · ') || undefined}
        actions={
          can('purchases.pay') && (
            <>
              <Button onClick={() => setPaying(true)}>Registrar pago</Button>
              <Button variant="secondary" onClick={() => setAdjusting(true)}>
                Ajustar saldo
              </Button>
            </>
          )
        }
      />
      <Card className="mb-4 p-4">
        <p className="text-sm text-slate-600">Saldo</p>
        <p className="font-display text-3xl font-bold tabular-nums">
          <SupplierBalance balance={s.balance} />
        </p>
      </Card>
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Movimientos</h2>
        {s.movements.length === 0 ? (
          <EmptyState>Sin movimientos. Al ingresar mercadería, marcá «Queda para pagar al proveedor» para que se sume acá.</EmptyState>
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
            {s.movements.map((m) => (
              <tr key={m.id}>
                <Td>{formatDateTime(m.createdAt)}</Td>
                <Td>
                  {KIND_LABELS[m.kind]}
                  {m.purchase && (
                    <>
                      {' · '}
                      <Link to="/app/compras/$id" params={{ id: m.purchase.id }} className="font-semibold text-brand-700 hover:underline">
                        compra N° {m.purchase.number}
                      </Link>
                      {m.purchase.document && ` (${m.purchase.document})`}
                    </>
                  )}
                  {m.method && ` · ${SUPPLIER_PAYMENT_METHODS[m.method]}`}
                  {(m.reference || m.notes) && <span className="block text-xs text-slate-500">{[m.reference, m.notes].filter(Boolean).join(' · ')}</span>}
                </Td>
                <Td>{m.userName}</Td>
                <Td className={`text-right font-semibold ${m.amount.startsWith('-') ? 'text-emerald-700' : 'text-red-700'}`}>{formatArs(m.amount)}</Td>
                <Td className="text-right">{formatArs(m.balanceAfter)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {paying && <PayDialog supplier={s} onClose={() => setPaying(false)} />}
      {adjusting && <AdjustDialog supplier={s} onClose={() => setAdjusting(false)} />}
    </>
  );
}

function PayDialog({ supplier, onClose }: { supplier: SupplierDetailDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const registers = useQuery(registersQuery);
  const openRegisters = (registers.data ?? []).filter((r) => r.openShift);
  const [clientUuid] = useState(newClientUuid);
  const [amount, setAmount] = useState(dec(supplier.balance).gt(0) ? supplier.balance.replace('.', ',') : '');
  const [method, setMethod] = useState<'cash' | 'transfer' | 'check' | 'other'>('transfer');
  const [registerId, setRegisterId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const register = registerId || openRegisters[0]?.id || '';
  const pay = useMutation({
    mutationFn: (body: unknown) => http.post(`/suppliers/${supplier.id}/payments`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast('Pago registrado');
      onClose();
    },
    onError: (err) => setError(err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR' ? (Object.values(err.fieldErrors())[0] ?? err.message) : errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (method === 'cash' && registers.isLoading) return;
    const parsed = supplierPaymentSchema.safeParse({ clientUuid, amount: parseDecimalInput(amount), method, registerId: method === 'cash' ? register || null : null, reference, notes });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
    setError(null);
    pay.mutate(parsed.data);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !pay.isPending && onClose()} title={`Pago a ${supplier.name}`} description={dec(supplier.balance).gt(0) ? `Se le debe ${formatArs(supplier.balance)}.` : undefined}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Importe">{(p) => <Input {...p} autoFocus inputMode="decimal" className="h-12 text-right text-xl font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Medio">
            {(p) => (
              <Select {...p} className="h-12" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {Object.entries(SUPPLIER_PAYMENT_METHODS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {method === 'cash' && (
            <Field label="Caja" hint="El efectivo sale de esta caja.">
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
          )}
          {method !== 'cash' && <Field label="Referencia" hint="Opcional: N° de operación o de cheque.">{(p) => <Input {...p} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>}
        </div>
        <Field label="Notas" hint="Opcional.">{(p) => <Input {...p} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pay.isPending}>
            Volver
          </Button>
          <Button type="submit" loading={pay.isPending || (method === 'cash' && registers.isLoading)}>
            Registrar pago
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AdjustDialog({ supplier, onClose }: { supplier: SupplierDetailDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [direction, setDirection] = useState<'debt' | 'credit'>('debt');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const adjust = useMutation({
    mutationFn: (body: unknown) => http.post(`/suppliers/${supplier.id}/adjustments`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
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
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Ajustar saldo" description="Para cargar lo que ya se le debía, o una nota de crédito o corrección del proveedor. Queda registrado con el motivo.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            {(p) => (
              <Select {...p} value={direction} onChange={(e) => setDirection(e.target.value as 'debt' | 'credit')}>
                <option value="debt">Suma deuda</option>
                <option value="credit">Resta deuda</option>
              </Select>
            )}
          </Field>
          <Field label="Importe">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        </div>
        <Field label="Motivo">{(p) => <Input {...p} maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: saldo al 1/11 según su cuenta" />}</Field>
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
