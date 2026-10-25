import { createStockCountSchema, type StockCountDetailDto, type StockCountDto, type StockCountLineDto } from '@gc/contracts';
import { dec } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { warehousesQuery } from '@/features/catalog/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime, formatQty, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { ProductPicker } from './product-picker';

const STATUS: Record<StockCountDto['status'], { label: string; tone: 'brand' | 'green' | 'slate' }> = {
  open: { label: 'Abierto', tone: 'brand' },
  closed: { label: 'Cerrado', tone: 'green' },
  cancelled: { label: 'Cancelado', tone: 'slate' },
};

function NewCount({ onDone }: { onDone: (id: string) => void }) {
  const warehouses = useQuery(warehousesQuery);
  const [warehouseId, setWarehouseId] = useState('');
  const [scope, setScope] = useState<'partial' | 'total'>('partial');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: unknown) => http.post<StockCountDetailDto>('/stock-counts', body),
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
      onDone(c.id);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const warehouse = warehouseId || warehouses.data?.find((w) => w.isDefault)?.id || '';
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createStockCountSchema.safeParse({ warehouseId: warehouse, scope, notes });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
    create.mutate(parsed.data);
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      {warehouses.data && warehouses.data.length > 1 && (
        <Field label="Depósito">
          {(p) => (
            <Select {...p} value={warehouse} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.data.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.branchName} · {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field
        label="Alcance"
        hint={
          scope === 'partial'
            ? 'Solo se corrigen los artículos que cuentes (por ejemplo, una góndola).'
            : 'Al cerrar, todo lo que tenga stock y no hayas contado queda en cero.'
        }
      >
        {(p) => (
          <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as 'partial' | 'total')}>
            <option value="partial">Parcial</option>
            <option value="total">Total (todo el depósito)</option>
          </Select>
        )}
      </Field>
      <Field label="Nota" hint="Opcional.">
        {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: góndola de bebidas" />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={create.isPending}>
          Empezar recuento
        </Button>
      </div>
    </form>
  );
}

export function CountsPage() {
  const can = useCan();
  const allowed = can('stock.count');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: () => http.get<StockCountDto[]>('/stock-counts'), enabled: allowed });
  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="Inventario físico"
        description="Contá la mercadería y el sistema corrige el stock por la diferencia. Lo que se vende mientras contás no se toma como faltante."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden /> Nuevo recuento
          </Button>
        }
      />
      <Card>
        {counts.isLoading && <Spinner />}
        {counts.error && <div className="p-4"><Alert>{errorMessage(counts.error)}</Alert></div>}
        {counts.data?.length === 0 && <EmptyState>Todavía no hiciste ningún recuento.</EmptyState>}
        {counts.data && counts.data.length > 0 && (
          <Table head={<><Th>Inicio</Th><Th>Depósito</Th><Th>Alcance</Th><Th>Nota</Th><Th className="text-right">Artículos</Th><Th>Estado</Th><Th /></>}>
            {counts.data.map((c) => (
              <tr key={c.id}>
                <Td className="whitespace-nowrap">
                  {formatDateTime(c.createdAt)}
                  <div className="text-xs text-slate-500">{c.createdByName}</div>
                </Td>
                <Td>{c.warehouseName}</Td>
                <Td>{c.scope === 'total' ? 'Total' : 'Parcial'}</Td>
                <Td className="text-slate-600">{c.notes ?? '—'}</Td>
                <Td className="text-right">{c.lineCount}</Td>
                <Td>
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </Td>
                <Td className="text-right">
                  <Link to="/app/inventarios/$id" params={{ id: c.id }} className="text-sm font-semibold text-brand-700 hover:underline">
                    {c.status === 'open' ? 'Continuar' : 'Ver'}
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Nuevo recuento">
        {open && <NewCount onDone={(id) => void navigate({ to: '/app/inventarios/$id', params: { id } })} />}
      </Dialog>
    </>
  );
}

function CountedInput({ line, disabled, onSave }: { line: StockCountLineDto; disabled: boolean; onSave: (value: string | null) => void }) {
  const [value, setValue] = useState(toInputDecimal(line.counted));
  const [prev, setPrev] = useState(line.counted);
  // Si el valor cambia desde el servidor (otro escaneo), se refleja en el campo.
  if (prev !== line.counted) {
    setPrev(line.counted);
    setValue(toInputDecimal(line.counted));
  }
  const commit = () => {
    const parsed = parseDecimalInput(value);
    if (parsed === '') return setValue(toInputDecimal(line.counted));
    if (/^\d+(\.\d+)?$/.test(parsed) && dec(parsed).eq(line.counted)) return;
    onSave(parsed);
  };
  return (
    <Input
      aria-label={`Cantidad contada de ${line.name}`}
      inputMode="decimal"
      className="ml-auto w-28 text-right"
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
    />
  );
}

export function CountDetailPage() {
  const can = useCan();
  const allowed = can('stock.count');
  const { id } = useParams({ from: '/app/inventarios/$id' });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = useQuery({ queryKey: ['stock-counts', id], queryFn: () => http.get<StockCountDetailDto>(`/stock-counts/${id}`), enabled: allowed });
  const refresh = (data: StockCountDetailDto) => {
    queryClient.setQueryData(['stock-counts', id], data);
    void queryClient.invalidateQueries({ queryKey: ['stock-counts'], exact: true });
  };
  const saveLine = useMutation({
    mutationFn: (line: { variantId: string; counted: string | null }) => http.put<StockCountDetailDto>(`/stock-counts/${id}/lines`, { lines: [line] }),
    onSuccess: (data) => (setError(null), refresh(data)),
    onError: (err) => setError(errorMessage(err)),
  });
  const finish = useMutation({
    mutationFn: (action: 'close' | 'cancel') => http.post<StockCountDetailDto>(`/stock-counts/${id}/${action}`),
    onSuccess: async (data, action) => {
      refresh(data);
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(action === 'close' ? 'Recuento cerrado: el stock quedó corregido' : 'Recuento cancelado');
    },
    onError: (err) => setError(errorMessage(err)),
  });
  if (!allowed) return <Forbidden />;
  if (count.isLoading) return <Spinner />;
  if (count.error) return <Alert>{errorMessage(count.error)}</Alert>;
  const c = count.data!;
  const isOpen = c.status === 'open';
  const differences = c.lines.filter((l) => !dec(l.difference).isZero());

  return (
    <>
      <PageHeader
        title={`Recuento ${c.scope === 'total' ? 'total' : 'parcial'} · ${c.warehouseName}`}
        description={`${c.notes ? `${c.notes} · ` : ''}Empezado el ${formatDateTime(c.createdAt)} por ${c.createdByName ?? '—'}`}
        actions={
          isOpen && (
            <>
              <Button variant="secondary" onClick={() => setConfirm('cancel')}>
                Cancelar recuento
              </Button>
              <Button onClick={() => setConfirm('close')}>Cerrar y corregir stock</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex items-center gap-3">
        <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
        <Link to="/app/inventarios" className="text-sm text-brand-700 hover:underline">
          Volver a los recuentos
        </Link>
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {isOpen && (
        <Card className="mb-4 p-4">
          <ProductPicker
            label="Escaneá o buscá el artículo que estás contando"
            onPick={(p, factor) => {
              const current = c.lines.find((l) => l.variantId === p.variantId);
              saveLine.mutate({ variantId: p.variantId, counted: dec(current?.counted ?? '0').plus(factor).toFixed(3) });
            }}
          />
          <p className="mt-2 text-xs text-slate-500">Cada lectura suma una unidad (o las del pack). Podés corregir la cantidad en la tabla.</p>
        </Card>
      )}
      <Card>
        {c.lines.length === 0 && <EmptyState>Todavía no contaste ningún artículo.</EmptyState>}
        {c.lines.length > 0 && (
          <Table head={<><Th>Artículo</Th><Th className="text-right">Figuraba</Th><Th className="text-right">Contado</Th><Th className="text-right">Diferencia</Th><Th /></>}>
            {c.lines.map((l) => (
              <tr key={l.variantId}>
                <Td>
                  <div className="font-medium">{l.name}</div>
                  <div className="text-xs text-slate-500">Contado {formatDateTime(l.countedAt)}</div>
                </Td>
                <Td className="text-right whitespace-nowrap text-slate-600">{formatQty(l.expected, l.saleMode)}</Td>
                <Td className="text-right">
                  {isOpen ? (
                    <CountedInput line={l} disabled={saveLine.isPending} onSave={(v) => saveLine.mutate({ variantId: l.variantId, counted: v })} />
                  ) : (
                    formatQty(l.counted, l.saleMode)
                  )}
                </Td>
                <Td className={`text-right font-semibold whitespace-nowrap ${dec(l.difference).isNeg() ? 'text-red-700' : dec(l.difference).isZero() ? 'text-slate-500' : 'text-emerald-700'}`}>
                  {dec(l.difference).gt(0) ? '+' : ''}
                  {formatQty(l.difference, l.saleMode)}
                </Td>
                <Td className="text-right">
                  {isOpen && (
                    <Button size="sm" variant="ghost" onClick={() => saveLine.mutate({ variantId: l.variantId, counted: null })}>
                      Quitar
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'close' ? 'Cerrar el recuento' : 'Cancelar el recuento'}
      >
        <div className="space-y-4 text-sm">
          {confirm === 'close' ? (
            <p>
              Se van a corregir {differences.length} {differences.length === 1 ? 'artículo' : 'artículos'} con diferencias.
              {c.scope === 'total' && ' Como es un recuento total, lo que tiene stock y no contaste queda en cero.'} Esta acción no se puede deshacer, pero
              cualquier error se corrige con un ajuste.
            </p>
          ) : (
            <p>El stock no cambia. Las cantidades que cargaste se descartan.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Volver
            </Button>
            <Button variant={confirm === 'close' ? 'primary' : 'danger'} loading={finish.isPending} onClick={() => confirm && finish.mutate(confirm)}>
              {confirm === 'close' ? 'Cerrar y corregir' : 'Cancelar recuento'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
