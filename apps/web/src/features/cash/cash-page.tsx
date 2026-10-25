import type { CashShiftDto, CashShiftSummaryDto, Paginated, RegisterDto } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { registersQuery, shiftQuery } from '@/features/sales/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';

const CASH_PERMS = ['cash.open', 'cash.close', 'cash.count', 'cash.read_all'] as const;

const MOVEMENT_LABELS: Record<CashShiftDto['movements'][number]['type'], string> = {
  sale: 'Venta en efectivo',
  refund: 'Devolución en efectivo',
  void: 'Anulación',
  withdrawal: 'Retiro',
  deposit: 'Ingreso',
};

const moneyOk = (v: string) => /^\d{1,12}(\.\d{1,2})?$/.test(v);

function Diff({ value }: { value: string | null }) {
  if (value === null) return <>—</>;
  const d = dec(value);
  return <span className={d.isZero() ? 'text-emerald-700' : d.lt(0) ? 'text-red-700' : 'text-orange-700'}>{d.gt(0) ? `+${formatArs(value)}` : formatArs(value)}</span>;
}

export function CashPage() {
  const can = useCan();
  const allowed = can(...CASH_PERMS);
  const registers = useQuery({ ...registersQuery, enabled: allowed });
  const [page, setPage] = useState(1);
  const shifts = useQuery({
    queryKey: ['shifts', 'list', page],
    queryFn: () => http.get<Paginated<CashShiftSummaryDto>>(`/shifts?status=closed&page=${page}&pageSize=20`),
    enabled: allowed,
  });
  const [opening, setOpening] = useState<RegisterDto | null>(null);

  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader title="Caja" description="Apertura, retiros, arqueos y cierre de cada caja." />
      {registers.isLoading && <Spinner />}
      {registers.error && <Alert>{errorMessage(registers.error)}</Alert>}
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(registers.data ?? [])
          .filter((r) => r.status === 'active')
          .map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{r.name}</h2>
                  <p className="text-sm text-slate-600">{r.branchName}</p>
                </div>
                {r.openShift ? <Badge tone="green">Abierta</Badge> : <Badge>Cerrada</Badge>}
              </div>
              {r.openShift ? (
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-slate-600">
                    Abrió {r.openShift.openedByName} el {formatDateTime(r.openShift.openedAt)}
                  </p>
                  <Link
                    to="/app/caja/$id"
                    params={{ id: r.openShift.id }}
                    className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800"
                  >
                    Ver turno
                  </Link>
                </div>
              ) : (
                can('cash.open') && (
                  <Button className="mt-4" onClick={() => setOpening(r)}>
                    Abrir caja
                  </Button>
                )
              )}
            </Card>
          ))}
      </div>
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Turnos cerrados</h2>
        {shifts.data && shifts.data.items.length === 0 && <EmptyState>Todavía no hay turnos cerrados.</EmptyState>}
        {shifts.data && shifts.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Caja</Th>
                <Th>Apertura</Th>
                <Th>Cierre</Th>
                <Th className="text-right">Diferencia</Th>
              </>
            }
          >
            {shifts.data.items.map((s) => (
              <tr key={s.id}>
                <Td>
                  <Link to="/app/caja/$id" params={{ id: s.id }} className="font-semibold text-brand-700 hover:underline">
                    {s.registerName}
                  </Link>
                </Td>
                <Td>
                  {formatDateTime(s.openedAt)} · {s.openedByName}
                </Td>
                <Td>
                  {s.closedAt && formatDateTime(s.closedAt)} · {s.closedByName}
                </Td>
                <Td className="text-right font-semibold">
                  <Diff value={s.difference} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {shifts.data && <Pager page={page} pageSize={20} total={shifts.data.total} onPage={setPage} />}
      </Card>
      {opening && <OpenDialog register={opening} onClose={() => setOpening(null)} />}
    </>
  );
}

function OpenDialog({ register, onClose }: { register: RegisterDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const open = useMutation({
    mutationFn: () => http.post<CashShiftDto>('/shifts', { registerId: register.id, openingFloat: parseDecimalInput(amount || '0') }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['registers'] });
      toast(`${register.name} abierta`);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Abrir ${register.name}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          open.mutate();
        }}
        noValidate
      >
        {open.error && <Alert>{errorMessage(open.error)}</Alert>}
        <Field label="Efectivo con el que arranca la caja" hint="El cambio que dejás en el cajón al abrir.">
          {(p) => <Input {...p} inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" loading={open.isPending}>
            Abrir caja
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type Action = 'withdrawal' | 'deposit' | 'count' | 'close' | null;

export function ShiftPage() {
  const { id } = useParams({ from: '/app/caja/$id' });
  const can = useCan();
  const shift = useQuery({ ...shiftQuery(id), enabled: can(...CASH_PERMS) });
  const [action, setAction] = useState<Action>(null);

  if (!can(...CASH_PERMS)) return <Forbidden />;
  if (shift.isLoading) return <Spinner />;
  if (shift.error) return <Alert>{errorMessage(shift.error)}</Alert>;
  const s = shift.data!;
  const open = s.status === 'open';

  return (
    <>
      <PageHeader
        title={`${s.registerName} · ${open ? 'turno abierto' : 'turno cerrado'}`}
        description={`Abrió ${s.openedByName} el ${formatDateTime(s.openedAt)}${s.closedAt ? ` · Cerró ${s.closedByName} el ${formatDateTime(s.closedAt)}` : ''}`}
        actions={
          open ? (
            <>
              {can('cash.withdraw') && (
                <Button variant="secondary" onClick={() => setAction('withdrawal')}>
                  Retiro
                </Button>
              )}
              {can('cash.deposit') && (
                <Button variant="secondary" onClick={() => setAction('deposit')}>
                  Ingreso
                </Button>
              )}
              {can('cash.count') && (
                <Button variant="secondary" onClick={() => setAction('count')}>
                  Arqueo
                </Button>
              )}
              {can('cash.close') && <Button onClick={() => setAction('close')}>Cerrar caja</Button>}
            </>
          ) : undefined
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Fondo inicial" value={formatArs(s.openingFloat)} />
        <Stat label={s.salesCount === 1 ? '1 venta' : `${s.salesCount} ventas`} value={formatArs(s.salesTotal)} />
        <Stat label="Efectivo esperado" value={s.expectedCash === null ? 'Se ve al cerrar' : formatArs(s.expectedCash)} />
        {!open && (
          <Stat
            label="Contado al cerrar"
            value={
              <>
                {formatArs(s.countedCash ?? '0')}{' '}
                <span className="text-base">
                  (<Diff value={s.difference} />)
                </span>
              </>
            }
          />
        )}
      </div>
      {s.closingNotes && (
        <div className="mb-6">
          <Alert kind="info">Nota del cierre: {s.closingNotes}</Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        {s.totalsByMethod && (
          <Card>
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Cobrado por medio de pago</h2>
            {s.totalsByMethod.length === 0 ? (
              <EmptyState>Sin ventas en el turno.</EmptyState>
            ) : (
              <Table
                head={
                  <>
                    <Th>Medio</Th>
                    <Th className="text-right">Ventas</Th>
                    <Th className="text-right">Devoluciones</Th>
                    <Th className="text-right">Neto</Th>
                  </>
                }
              >
                {s.totalsByMethod.map((m) => (
                  <tr key={m.paymentMethodId}>
                    <Td>{m.name}</Td>
                    <Td className="text-right">{formatArs(m.sales)}</Td>
                    <Td className="text-right">{m.refunds === '0.00' ? '—' : `−${formatArs(m.refunds)}`}</Td>
                    <Td className="text-right font-semibold">{formatArs(m.net)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
        <Card>
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Movimientos de efectivo</h2>
          {s.movements.length === 0 ? (
            <EmptyState>Sin movimientos.</EmptyState>
          ) : (
            <Table
              head={
                <>
                  <Th>Hora</Th>
                  <Th>Tipo</Th>
                  <Th>Detalle</Th>
                  <Th className="text-right">Importe</Th>
                </>
              }
            >
              {s.movements.map((m) => (
                <tr key={m.id}>
                  <Td>{formatDateTime(m.occurredAt)}</Td>
                  <Td>{MOVEMENT_LABELS[m.type]}</Td>
                  <Td>
                    {m.reason ?? '—'}
                    <span className="block text-xs text-slate-500">{m.userName}</span>
                  </Td>
                  <Td className={`text-right font-semibold ${dec(m.amount).lt(0) ? 'text-red-700' : ''}`}>{formatArs(m.amount)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {s.counts.length > 0 && (
          <Card>
            <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Arqueos</h2>
            <Table
              head={
                <>
                  <Th>Hora</Th>
                  <Th>Tipo</Th>
                  <Th className="text-right">Contado</Th>
                  <Th className="text-right">Diferencia</Th>
                </>
              }
            >
              {s.counts.map((c, i) => (
                <tr key={i}>
                  <Td>
                    {formatDateTime(c.countedAt)}
                    <span className="block text-xs text-slate-500">{c.countedByName}</span>
                  </Td>
                  <Td>{c.kind === 'closing' ? 'Cierre' : 'Parcial'}</Td>
                  <Td className="text-right">{formatArs(c.counted)}</Td>
                  <Td className="text-right font-semibold">{c.difference === null ? 'Se ve al cerrar' : <Diff value={c.difference} />}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
      {action && <ShiftActionDialog shift={s} action={action} onClose={() => setAction(null)} />}
    </>
  );
}

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Card className="p-4">
    <div className="text-sm text-slate-600">{label}</div>
    <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
  </Card>
);

const ACTION_TEXT: Record<Exclude<Action, null>, { title: string; amount: string; button: string; done: string; description?: string }> = {
  withdrawal: { title: 'Retiro de efectivo', amount: 'Importe que sale de la caja', button: 'Registrar retiro', done: 'Retiro registrado' },
  deposit: { title: 'Ingreso de efectivo', amount: 'Importe que entra a la caja', button: 'Registrar ingreso', done: 'Ingreso registrado' },
  count: { title: 'Arqueo parcial', amount: 'Efectivo contado en el cajón', button: 'Registrar arqueo', done: 'Arqueo registrado', description: 'Contá el efectivo sin cerrar la caja.' },
  close: {
    title: 'Cerrar caja',
    amount: 'Efectivo contado en el cajón',
    button: 'Cerrar caja',
    done: 'Caja cerrada',
    description: 'Contá todo el efectivo del cajón, incluido el fondo inicial. La diferencia se muestra después de cerrar.',
  },
};

function ShiftActionDialog({ shift, action, onClose }: { shift: CashShiftDto; action: Exclude<Action, null>; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const t = ACTION_TEXT[action];
  const save = useMutation({
    mutationFn: (value: string) => {
      if (action === 'count') return http.post<CashShiftDto>(`/shifts/${shift.id}/counts`, { counted: value });
      if (action === 'close') return http.post<CashShiftDto>(`/shifts/${shift.id}/close`, { counted: value, notes: text.trim() || null });
      return http.post<CashShiftDto>(`/shifts/${shift.id}/movements`, { type: action, amount: value, reason: text.trim() });
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(['shifts', shift.id], data);
      await queryClient.invalidateQueries({ queryKey: ['registers'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts', 'list'] });
      toast(t.done);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseDecimalInput(amount);
    if (!moneyOk(value)) return setError('Importe inválido');
    if ((action === 'withdrawal' || action === 'deposit') && !text.trim()) return setError('Escribí el motivo');
    setError(null);
    save.mutate(value);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t.title} description={t.description}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label={t.amount}>{(p) => <Input {...p} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        {action !== 'count' && (
          <Field label={action === 'close' ? 'Nota (opcional)' : 'Motivo'}>{(p) => <Input {...p} value={text} onChange={(e) => setText(e.target.value)} maxLength={action === 'close' ? 300 : 200} />}</Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t.button}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
