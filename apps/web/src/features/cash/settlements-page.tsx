import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatArs } from '@gc/domain';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { Forbidden } from '@/features/layout/app-layout';
import { paymentMethodsQuery } from '@/features/sales/queries';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';

type Summary = { id: string; provider: string; methodName: string; fromDate: string; toDate: string; status: 'open' | 'closed' };
type Item = { id: string; saleId: string | null; saleNumber: number | null; reference: string | null; externalId: string | null; expected: string | null; gross: string | null; fees: string | null; net: string | null; creditedOn: string | null; status: 'pending' | 'confirmed' | 'observed'; notes: string | null; reviewedBy: string | null; cashierName: string; registerName: string; saleChanged: boolean };
type Detail = Summary & { items: Item[]; totals: Record<'expected' | 'gross' | 'fees' | 'net', string>; closingNotes: string | null; closedAt: string | null; closedBy: string | null };
const LABELS = { pending: 'Pendiente', confirmed: 'Confirmado', observed: 'Observado' };
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Buenos_Aires' }).format(new Date());

export function SettlementsPage() {
  const allowed = useCan()('cash.read_all');
  const client = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [method, setMethod] = useState('');
  const [provider, setProvider] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const list = useQuery({ queryKey: ['settlements'], queryFn: () => http.get<Summary[]>('/settlements'), enabled: allowed });
  const methods = useQuery({ ...paymentMethodsQuery, enabled: allowed });
  const create = useMutation({ mutationFn: () => http.post<Detail>('/settlements', { paymentMethodId: method, provider, fromDate: from, toDate: to }), onSuccess: async (data) => { await client.invalidateQueries({ queryKey: ['settlements'] }); setSelected(data.id); setCreating(false); toast('Rendición creada'); } });
  if (!allowed) return <Forbidden />;
  if (selected) return <SettlementDetail id={selected} onBack={() => setSelected(null)} />;
  return <>
    <PageHeader title="Rendición de cobros" description="Compará lo registrado en ventas con los movimientos de Mercado Pago, Ualá, bancos o terminales." actions={<Button onClick={() => setCreating(true)}>Nueva rendición</Button>} />
    <div className="mb-5"><Alert kind="info">Creá un medio de pago distinto para cada cuenta o terminal (por ejemplo, «MP · QR» y «Ualá · Débito») en Administración → Cajas y medios de pago. La rendición controla cobros; no modifica ventas ni el saldo del cajón.</Alert></div>
    <Card>{list.isLoading && <Spinner />}{list.error && <Alert>{errorMessage(list.error)}</Alert>}{list.data?.length === 0 && <EmptyState>Todavía no hay rendiciones.</EmptyState>}
      {!!list.data?.length && <Table head={<><Th>Proveedor / cuenta</Th><Th>Período de ventas</Th><Th>Estado</Th><Th /></>}>{list.data.map(s => <tr key={s.id}><Td><p className="font-semibold">{s.provider}</p><p className="text-xs text-slate-500">{s.methodName}</p></Td><Td>{s.fromDate} → {s.toDate}</Td><Td><Badge tone={s.status === 'closed' ? 'green' : 'amber'}>{s.status === 'closed' ? 'Cerrada' : 'Abierta'}</Badge></Td><Td><Button size="sm" variant="secondary" onClick={() => setSelected(s.id)}>Ver rendición</Button></Td></tr>)}</Table>}
    </Card><p className="mt-3 text-xs text-slate-500">Se muestran las últimas 100 rendiciones. No se superponen períodos de rendiciones abiertas de una misma cuenta. Después del cierre, otra rendición puede tomar los cobros nuevos de esas fechas sin repetir los anteriores.</p>
    <Dialog open={creating} onOpenChange={setCreating} title="Nueva rendición"><form className="space-y-4" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
      {create.error && <Alert>{errorMessage(create.error)}</Alert>}
      <Field label="Cuenta o terminal de cobro">{p => <Select {...p} required value={method} onChange={e => setMethod(e.target.value)}><option value="">Elegí un medio de pago</option>{methods.data?.filter(m => m.kind !== 'cash').map(m => <option key={m.id} value={m.id}>{m.name}{!m.active ? ' (inactivo)' : ''}</option>)}</Select>}</Field>
      <Field label="Proveedor / identificación de cuenta" hint="Ej.: Mercado Pago · Kiosco Central, Ualá o Banco · cuenta terminada en 1234.">{p => <Input {...p} required maxLength={80} value={provider} onChange={e => setProvider(e.target.value)} />}</Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Ventas desde">{p => <Input {...p} required type="date" value={from} onChange={e => setFrom(e.target.value)} />}</Field><Field label="Hasta">{p => <Input {...p} required type="date" min={from} value={to} onChange={e => setTo(e.target.value)} />}</Field></div>
      <p className="text-xs text-slate-500">Fechas de Argentina. Incluye ventas confirmadas de ese medio de pago; la fecha de acreditación puede ser posterior.</p>
      <Button type="submit" loading={create.isPending}>Crear rendición</Button>
    </form></Dialog>
  </>;
}

function SettlementDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [reviewing, setReviewing] = useState<Item | null>(null);
  const [matching, setMatching] = useState<Item | null>(null);
  const [closing, setClosing] = useState(false);
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['settlements', id], queryFn: () => http.get<Detail>(`/settlements/${id}`) });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['settlements'] }); };
  const close = useMutation({ mutationFn: () => http.post(`/settlements/${id}/close`, { notes }), onSuccess: async () => { await refresh(); setClosing(false); toast('Rendición cerrada'); } });
  const reload = useMutation({ mutationFn: () => http.post(`/settlements/${id}/refresh`), onSuccess: refresh });
  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <><Button onClick={onBack}>Volver</Button><Alert>{errorMessage(query.error)}</Alert></>;
  const s = query.data;
  const rows = s.items.filter(i => (!filter || i.status === filter) && `${i.saleNumber ?? ''} ${i.reference ?? ''} ${i.externalId ?? ''} ${i.cashierName} ${i.registerName}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader title={s.provider} description={`${s.methodName} · Ventas del ${s.fromDate} al ${s.toDate}`} actions={<><Button variant="secondary" onClick={onBack}>Volver</Button>{s.status === 'open' && <><Button variant="secondary" onClick={() => setImporting(true)}>Importar reporte CSV</Button><Button onClick={() => setClosing(true)}>Cerrar rendición</Button></>}</>} />
    {s.status === 'open' && <div className="mb-5 flex flex-wrap items-center gap-3"><Button size="sm" variant="ghost" loading={reload.isPending} onClick={() => reload.mutate()}>Actualizar cobros del período</Button><p className="text-xs text-slate-500">Usalo si hubo ventas después de crear la rendición.</p>{reload.error && <Alert>{errorMessage(reload.error)}</Alert>}</div>}
    {s.status === 'closed' && <div className="mb-5"><Alert kind="info">Cerrada por {s.closedBy} · {formatDateTime(s.closedAt!)}. {s.closingNotes}</Alert></div>}
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{([['expected', 'Registrado en ventas'], ['gross', 'Bruto verificado / importado'], ['fees', 'Comisiones y deducciones'], ['net', 'Neto reportado']] as const).map(([key, label]) => <Card key={key} className="p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 font-display text-xl font-semibold">{formatArs(s.totals[key])}</p></Card>)}</div>
    <p className="mb-5 text-xs leading-relaxed text-slate-500">Confirmado indica que se verificó el cobro. La acreditación se registra por separado. Los totales importados incluyen movimientos sin vincular; revisá las observaciones. Anulaciones y devoluciones se señalan y se resuelven con una observación, sin descontarlas automáticamente.</p>
    <div className="mb-4 flex flex-wrap gap-3"><Input aria-label="Buscar en rendición" className="sm:w-80" placeholder="Venta, operación, cajero o caja" value={search} onChange={e => setSearch(e.target.value)} /><Select aria-label="Filtrar estado" className="sm:w-48" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Todos los estados</option>{Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
    <Card><Table head={<><Th>Venta / operación</Th><Th>Registrado</Th><Th>Bruto</Th><Th>Deducciones / neto</Th><Th>Control</Th><Th /></>}>
      {rows.map(i => <tr key={i.id}><Td>{i.saleId ? <Link className="font-semibold text-brand-700" to="/app/ventas/$id" params={{ id: i.saleId }}>Venta {i.saleNumber}</Link> : <Badge tone="amber">Sin venta vinculada</Badge>}<p className="mt-1 text-xs">Referencia: {i.reference || '—'}</p><p className="text-xs">Reporte: {i.externalId || '—'}</p><p className="text-xs text-slate-500">{i.cashierName} · {i.registerName}</p>{i.saleChanged && <p className="mt-1 text-xs font-semibold text-red-700">Venta anulada o con devolución: revisar</p>}</Td><Td>{i.expected === null ? '—' : formatArs(i.expected)}</Td><Td>{i.gross === null ? '—' : formatArs(i.gross)}</Td><Td>{i.fees === null ? '—' : formatArs(i.fees)}<p className="font-semibold">Neto: {i.net === null ? '—' : formatArs(i.net)}</p><p className="text-xs text-slate-500">Acreditación: {i.creditedOn || 'Sin verificar'}</p></Td><Td><Badge tone={i.status === 'confirmed' ? 'green' : i.status === 'observed' ? 'red' : 'amber'}>{LABELS[i.status]}</Badge><p className="mt-1 max-w-52 whitespace-pre-wrap text-xs text-slate-500">{i.notes}</p>{i.reviewedBy && <p className="mt-1 text-xs text-slate-500">Revisó: {i.reviewedBy}</p>}</Td><Td>{s.status === 'open' && <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setReviewing(i)}>Revisar</Button>{!i.saleId && <Button size="sm" variant="ghost" onClick={() => setMatching(i)}>Vincular venta</Button>}</div>}</Td></tr>)}
    </Table>{rows.length === 0 && <EmptyState>No hay movimientos con estos filtros.</EmptyState>}</Card>
    {importing && <ImportDialog id={id} onClose={() => setImporting(false)} onSaved={refresh} />}
    {reviewing && <ReviewDialog id={id} item={reviewing} onClose={() => setReviewing(null)} onSaved={refresh} />}
    {matching && <MatchDialog id={id} item={matching} candidates={s.items.filter(i => i.saleId && !i.externalId && i.status === 'pending')} onClose={() => setMatching(null)} onSaved={refresh} />}
    <Dialog open={closing} onOpenChange={setClosing} title="Cerrar rendición"><form className="space-y-4" onSubmit={e => { e.preventDefault(); close.mutate(); }}>{close.error && <Alert>{errorMessage(close.error)}</Alert>}<p className="text-sm text-slate-600">El cierre conserva el control y su responsable. Después no se puede editar. Revisá los pendientes; las diferencias deben quedar observadas con motivo.</p><Field label="Observaciones del cierre">{p => <Input {...p} required maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} />}</Field><Button type="submit" loading={close.isPending}>Confirmar cierre</Button></form></Dialog>
  </>;
}

function ImportDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [csv, setCsv] = useState('');
  const [delimiter, setDelimiter] = useState(';');
  const [decimal, setDecimal] = useState(',');
  const [columns, setColumns] = useState<Record<string, string>>({ reference: '0', gross: '1', fees: '2', net: '', date: '' });
  const [fileError, setFileError] = useState('');
  // Solo se muestran los encabezados aquí; el servidor procesa correctamente las filas entrecomilladas.
  const header = csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0]?.split(delimiter).map(v => v.replace(/^"|"$/g, '')) ?? [];
  const save = useMutation({ mutationFn: () => http.post(`/settlements/${id}/import`, { csv, delimiter, decimal, columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v === '' ? null : Number(v)])) }), onSuccess: async () => { await onSaved(); onClose(); } });
  return <Dialog open onOpenChange={o => !o && onClose()} title="Importar reporte de cobros" wide><form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    {(fileError || save.error) && <Alert>{fileError || errorMessage(save.error)}</Alert>}
    <Alert kind="info">Exportá o prepará un CSV de cobros positivos en ARS de esta cuenta. Separá transferencias entre cuentas, devoluciones, retenciones y otros movimientos; las deducciones totales deben estar incluidas en la columna de deducciones. Solo se concilia automáticamente si coinciden una referencia única y el importe bruto.</Alert>
    <Field label="Archivo CSV (hasta 2 MB, 2000 movimientos)">{p => <Input {...p} type="file" accept=".csv,text/csv" required onChange={async e => { const file = e.target.files?.[0]; setFileError(''); if (!file) return; if (file.size > 2000000) return setFileError('El archivo supera los 2 MB'); const buffer = await file.arrayBuffer(); let text = new TextDecoder('utf-8', { fatal: true }); try { setCsv(text.decode(buffer)); } catch { text = new TextDecoder('windows-1252'); setCsv(text.decode(buffer)); } }} />}</Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Separador de columnas">{p => <Select {...p} value={delimiter} onChange={e => setDelimiter(e.target.value)}><option value=";">Punto y coma (;)</option><option value=",">Coma (,)</option></Select>}</Field><Field label="Separador decimal">{p => <Select {...p} value={decimal} onChange={e => setDecimal(e.target.value)}><option value=",">Coma: 1.250,50</option><option value=".">Punto: 1,250.50</option></Select>}</Field></div>
    {csv && <div className="grid gap-3 sm:grid-cols-2">{[['reference', 'Identificador de operación'], ['gross', 'Importe bruto'], ['fees', 'Comisiones / deducciones'], ['net', 'Importe neto'], ['date', 'Acreditación (AAAA-MM-DD)']].map(([key, label]) => <Field key={key} label={label!}>{p => <Select {...p} required={key === 'reference' || key === 'gross'} value={columns[key!] ?? ''} onChange={e => setColumns({ ...columns, [key!]: e.target.value })}><option value="">No incluir</option>{header.map((h, i) => <option key={i} value={i}>{i + 1}. {h}</option>)}</Select>}</Field>)}</div>}
    <p className="text-xs text-slate-500">Seleccioná deducciones o neto (al menos uno). Esta carga importa el reporte; no consulta al proveedor ni confirma por importe y fecha solamente.</p>
    <Button type="submit" disabled={!csv || !!fileError} loading={save.isPending}>Importar y comparar</Button>
  </form></Dialog>;
}

function ReviewDialog({ id, item, onClose, onSaved }: { id: string; item: Item; onClose: () => void; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState(item.status);
  const [gross, setGross] = useState(toInputDecimal(item.gross ?? item.expected));
  const [fees, setFees] = useState(toInputDecimal(item.fees ?? '0'));
  const [net, setNet] = useState(toInputDecimal(item.net ?? item.expected));
  const [date, setDate] = useState(item.creditedOn ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const save = useMutation({ mutationFn: () => http.post(`/settlements/${id}/review`, { itemId: item.id, status, gross: parseDecimalInput(gross) || null, fees: parseDecimalInput(fees) || null, net: parseDecimalInput(net) || null, creditedOn: date || null, notes }), onSuccess: async () => { await onSaved(); onClose(); } });
  return <Dialog open onOpenChange={o => !o && onClose()} title="Verificar movimiento"><form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>{save.error && <Alert>{errorMessage(save.error)}</Alert>}<Field label="Estado">{p => <Select {...p} value={status} onChange={e => setStatus(e.target.value as Item['status'])}>{Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>{[['Bruto', gross, setGross], ['Deducciones', fees, setFees], ['Neto recibido', net, setNet]].map(([label, value, setter]) => <Field key={label as string} label={label as string}>{p => <Input {...p} inputMode="decimal" value={value as string} onChange={e => (setter as (v: string) => void)(e.target.value)} />}</Field>)}<Field label="Fecha de acreditación (opcional)">{p => <Input {...p} type="date" value={date} onChange={e => setDate(e.target.value)} />}</Field><Field label="Cómo lo verificaste / motivo de la observación">{p => <Input {...p} required maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} />}</Field><Button type="submit" loading={save.isPending}>Guardar revisión</Button></form></Dialog>;
}

function MatchDialog({ id, item, candidates, onClose, onSaved }: { id: string; item: Item; candidates: Item[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [sale, setSale] = useState('');
  const [notes, setNotes] = useState('');
  const save = useMutation({ mutationFn: () => http.post(`/settlements/${id}/match`, { reportItemId: item.id, saleItemId: sale, notes }), onSuccess: async () => { await onSaved(); onClose(); } });
  return <Dialog open onOpenChange={o => !o && onClose()} title="Vincular operación con una venta"><form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>{save.error && <Alert>{errorMessage(save.error)}</Alert>}<p className="text-sm">Operación {item.externalId} · {formatArs(item.gross ?? '0')}</p><Field label="Cobro registrado">{p => <Select {...p} required value={sale} onChange={e => setSale(e.target.value)}><option value="">Seleccioná el cobro que verificaste</option>{candidates.map(i => <option key={i.id} value={i.id}>Venta {i.saleNumber} · {i.reference || 'Sin referencia'} · {formatArs(i.expected!)}</option>)}</Select>}</Field><Field label="Motivo / comprobación realizada">{p => <Input {...p} required maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} />}</Field><Button type="submit" loading={save.isPending}>Vincular y verificar</Button></form></Dialog>;
}
