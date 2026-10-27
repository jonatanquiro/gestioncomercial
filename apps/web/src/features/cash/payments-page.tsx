import { PAYMENT_KIND_LABELS, type Paginated, type PaymentKind } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { Forbidden } from '@/features/layout/app-layout';
import { paymentMethodsQuery, registersQuery } from '@/features/sales/queries';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

type ItemStatus = 'pending' | 'confirmed' | 'observed';
type Payment = { id: string; saleId: string; saleNumber: number; confirmedAt: string; registerName: string; cashierName: string; paymentMethodId: string; methodName: string; kind: PaymentKind; amount: string; reference: string | null; saleChanged: boolean; duplicateReference: boolean; settlement: { id: string; provider: string; status: 'open' | 'closed'; itemStatus: ItemStatus } | null };
type Result = Paginated<Payment> & { totalAmount: string };
const PAGE_SIZE = 50;
const ITEM_LABELS: Record<ItemStatus, string> = { pending: 'Pendiente', confirmed: 'Confirmado', observed: 'Observado' };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Buenos_Aires' }).format(new Date());

export function PaymentsPage() {
  const allowed = useCan()('cash.read_all');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState('');
  const [method, setMethod] = useState('');
  const [register, setRegister] = useState('');
  const [settlement, setSettlement] = useState('');
  const [flag, setFlag] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const methods = useQuery({ ...paymentMethodsQuery, enabled: allowed });
  const registers = useQuery({ ...registersQuery, enabled: allowed });
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  Object.entries({ from, to, kind, paymentMethodId: method, registerId: register, settlement, flag, q: search.trim() }).forEach(([k, v]) => v && params.set(k, v));
  const list = useQuery({ queryKey: ['payments', params.toString()], queryFn: () => http.get<Result>(`/payments?${params}`), enabled: allowed });
  const filter = <T,>(setter: (v: T) => void) => (v: T) => (setter(v), setPage(1));
  const selectedMethod = methods.data?.find((m) => m.id === method);

  if (!allowed) return <Forbidden />;
  return <>
    <PageHeader title="Cobros" description="Transferencias, QR y tarjetas registrados en las ventas, con su estado de rendición." actions={<Button disabled={!selectedMethod || !from || !to} title={selectedMethod ? undefined : 'Elegí un medio de pago y las fechas'} onClick={() => setCreating(true)}>Crear rendición</Button>} />
    <Card>
      <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ventas desde">{(p) => <Input {...p} type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />}</Field>
        <Field label="Hasta">{(p) => <Input {...p} type="date" min={from} value={to} onChange={(e) => filter(setTo)(e.target.value)} />}</Field>
        <Field label="Tipo">{(p) => <Select {...p} value={kind} onChange={(e) => filter(setKind)(e.target.value)}><option value="">Todos menos efectivo</option>{(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).filter((k) => k !== 'cash').map((k) => <option key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</option>)}</Select>}</Field>
        <Field label="Medio de pago / cuenta">{(p) => <Select {...p} value={method} onChange={(e) => filter(setMethod)(e.target.value)}><option value="">Todos</option>{methods.data?.filter((m) => m.kind !== 'cash' && (!kind || m.kind === kind)).map((m) => <option key={m.id} value={m.id}>{m.name}{!m.active ? ' (inactivo)' : ''}</option>)}</Select>}</Field>
        <Field label="Caja">{(p) => <Select {...p} value={register} onChange={(e) => filter(setRegister)(e.target.value)}><option value="">Todas</option>{registers.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
        <Field label="Rendición">{(p) => <Select {...p} value={settlement} onChange={(e) => filter(setSettlement)(e.target.value)}><option value="">Cualquier estado</option><option value="none">Sin rendir</option>{Object.entries(ITEM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
        <Field label="Revisar">{(p) => <Select {...p} value={flag} onChange={(e) => filter(setFlag)(e.target.value)}><option value="">Todos los cobros</option><option value="duplicate">N° de operación repetido</option><option value="missing_reference">Sin N° de operación</option><option value="sale_changed">Venta anulada o con devolución</option></Select>}</Field>
        <Field label="Buscar">{(p) => <Input {...p} placeholder="N° de operación, venta o importe" maxLength={80} value={search} onChange={(e) => filter(setSearch)(e.target.value)} />}</Field>
      </div>
      {list.isLoading && <Spinner />}
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      {list.data && <p className="border-b border-slate-200 px-4 py-3 text-sm"><span className="font-semibold">{list.data.total}</span> cobros · <span className="font-semibold">{formatArs(list.data.totalAmount)}</span></p>}
      {list.data?.items.length === 0 && <EmptyState>No hay cobros con estos filtros.</EmptyState>}
      {!!list.data?.items.length && <Table head={<><Th>Venta</Th><Th>Medio de pago</Th><Th>N° de operación</Th><Th className="text-right">Importe</Th><Th>Rendición</Th></>}>
        {list.data.items.map((p) => <tr key={p.id}>
          <Td><Link to="/app/ventas/$id" params={{ id: p.saleId }} className="font-semibold text-brand-700 hover:underline">Venta {p.saleNumber}</Link><p className="text-xs text-slate-500">{formatDateTime(p.confirmedAt)}</p><p className="text-xs text-slate-500">{p.cashierName} · {p.registerName}</p></Td>
          <Td>{p.methodName}<p className="text-xs text-slate-500">{PAYMENT_KIND_LABELS[p.kind]}</p></Td>
          <Td>{p.reference ?? <Badge tone="amber">Sin N° de operación</Badge>}{p.duplicateReference && <p className="mt-1 text-xs font-semibold text-red-700">Repetido en otro cobro</p>}{p.saleChanged && <p className="mt-1 text-xs font-semibold text-red-700">Venta anulada o con devolución</p>}</Td>
          <Td className="text-right font-semibold">{formatArs(p.amount)}</Td>
          <Td>{p.settlement ? <><Badge tone={p.settlement.itemStatus === 'confirmed' ? 'green' : p.settlement.itemStatus === 'observed' ? 'red' : 'amber'}>{ITEM_LABELS[p.settlement.itemStatus]}</Badge><p className="mt-1 text-xs"><Link to="/app/rendiciones" search={{ id: p.settlement.id }} className="text-brand-700 hover:underline">{p.settlement.provider}</Link> · {p.settlement.status === 'closed' ? 'cerrada' : 'abierta'}</p></> : <Badge>Sin rendir</Badge>}</Td>
        </tr>)}
      </Table>}
      {list.data && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
    </Card>
    <p className="mt-3 text-xs text-slate-500">Fechas de Argentina, según la confirmación de la venta. Un N° de operación se marca repetido cuando aparece en más de un cobro del mismo medio de pago en ventas vigentes. La verificación de cada cobro se hace en la rendición.</p>
    {creating && selectedMethod && <CreateSettlementDialog methodId={selectedMethod.id} methodName={selectedMethod.name} from={from} to={to} onClose={() => setCreating(false)} />}
  </>;
}

function CreateSettlementDialog({ methodId, methodName, from, to, onClose }: { methodId: string; methodName: string; from: string; to: string; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [provider, setProvider] = useState(methodName);
  const create = useMutation({
    mutationFn: () => http.post<{ id: string }>('/settlements', { paymentMethodId: methodId, provider, fromDate: from, toDate: to }),
    onSuccess: async (data) => { await client.invalidateQueries({ queryKey: ['settlements'] }); await client.invalidateQueries({ queryKey: ['payments'] }); toast('Rendición creada'); void navigate({ to: '/app/rendiciones', search: { id: data.id } }); },
  });
  return <Dialog open onOpenChange={(o) => !o && onClose()} title="Crear rendición"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
    {create.error && <Alert>{errorMessage(create.error)}</Alert>}
    <p className="text-sm text-slate-600">Incluye los cobros <strong>sin rendir</strong> de ventas confirmadas de <strong>{methodName}</strong> del {from} al {to}. Los demás filtros no se aplican.</p>
    <Field label="Proveedor / identificación de cuenta" hint="Ej.: Mercado Pago · Kiosco Central, Ualá o Banco · cuenta terminada en 1234.">{(p) => <Input {...p} required maxLength={80} value={provider} onChange={(e) => setProvider(e.target.value)} />}</Field>
    <Button type="submit" loading={create.isPending}>Crear y abrir rendición</Button>
  </form></Dialog>;
}
