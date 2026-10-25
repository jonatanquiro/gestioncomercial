import { type Paginated, type StockOperationResult, type StockRowDto, stockAdjustmentSchema, stockWasteSchema } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { categoriesQuery, newClientUuid, warehousesQuery, zodFieldErrors } from '@/features/catalog/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatQty, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';

const PAGE_SIZE = 25;

type Operation = 'adjust' | 'waste';

function stockError(err: unknown) {
  if (err instanceof ApiRequestError && err.code === 'INSUFFICIENT_STOCK') {
    const d = (err.details as Array<{ name: string; onHand: string }>)[0];
    return `No hay stock suficiente de ${d?.name ?? 'este artículo'} (hay ${formatQty(d?.onHand)}) y el comercio no permite stock negativo.`;
  }
  return errorMessage(err);
}

/** Ajuste ("el stock real es…" o "sumar/restar") o merma de un artículo. */
function OperationForm({ row, warehouseId, operation, onDone }: { row: StockRowDto; warehouseId: string; operation: Operation; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Un mismo identificador por formulario: si el envío se repite (doble clic, corte de red), no se duplica.
  const [clientUuid] = useState(newClientUuid);
  const [mode, setMode] = useState<'set' | 'delta'>('set');
  const [wasteType, setWasteType] = useState<'waste' | 'expired'>('waste');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => http.post<StockOperationResult>(operation === 'adjust' ? '/stock/adjustments' : '/stock/waste', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(operation === 'adjust' ? 'Stock ajustado' : 'Merma registrada');
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors());
      setError(stockError(err));
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = parseDecimalInput(quantity);
    const parsed =
      operation === 'adjust'
        ? stockAdjustmentSchema.safeParse({ clientUuid, warehouseId, reason, lines: [{ variantId: row.variantId, mode, quantity: qty }] })
        : stockWasteSchema.safeParse({ clientUuid, warehouseId, reason, type: wasteType, lines: [{ variantId: row.variantId, quantity: qty }] });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    save.mutate(parsed.data);
  }
  const qtyError = errors['lines.0.quantity'];
  const preview = (() => {
    const q = parseDecimalInput(quantity);
    if (!/^-?\d+(\.\d+)?$/.test(q)) return null;
    const result = operation === 'waste' ? dec(row.onHand).minus(q) : mode === 'set' ? dec(q) : dec(row.onHand).plus(q);
    return result.toFixed(3);
  })();

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-slate-600">
        Stock actual: <span className="font-semibold text-slate-900">{formatQty(row.onHand, row.saleMode)}</span>
      </p>
      {operation === 'adjust' ? (
        <Field label="Tipo de ajuste">
          {(p) => (
            <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as 'set' | 'delta')}>
              <option value="set">El stock real es…</option>
              <option value="delta">Sumar o restar (con signo menos)</option>
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Motivo de la baja">
          {(p) => (
            <Select {...p} value={wasteType} onChange={(e) => setWasteType(e.target.value as 'waste' | 'expired')}>
              <option value="waste">Merma o rotura</option>
              <option value="expired">Vencimiento</option>
            </Select>
          )}
        </Field>
      )}
      <Field
        label={operation === 'waste' ? 'Cantidad que se da de baja' : mode === 'set' ? 'Cantidad contada' : 'Cantidad a sumar o restar'}
        error={qtyError}
        hint={preview !== null ? `Queda en ${formatQty(preview, row.saleMode)}` : undefined}
      >
        {(p) => <Input {...p} autoFocus inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
      </Field>
      <Field label="Detalle" error={errors.reason} hint="Obligatorio. Queda registrado junto con tu usuario.">
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={operation === 'waste' ? 'Ej.: se rompió al reponer' : 'Ej.: conteo de góndola'} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant={operation === 'waste' ? 'danger' : 'primary'} loading={save.isPending}>
          {operation === 'adjust' ? 'Ajustar stock' : 'Registrar baja'}
        </Button>
      </div>
    </form>
  );
}

export function StockPage() {
  const can = useCan();
  const allowed = can('stock.read');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [low, setLow] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [dialog, setDialog] = useState<{ row: StockRowDto; operation: Operation } | null>(null);
  const warehouses = useQuery({ ...warehousesQuery, enabled: allowed });
  const categories = useQuery({ ...categoriesQuery, enabled: allowed && can('products.read') });
  const warehouse = warehouseId || warehouses.data?.find((w) => w.isDefault)?.id || '';
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), warehouseId: warehouse, low: low ? '1' : '0' });
  if (search.trim()) params.set('q', search.trim());
  if (categoryId) params.set('categoryId', categoryId);
  const stock = useQuery({
    queryKey: ['stock', params.toString()],
    queryFn: () => http.get<Paginated<StockRowDto>>(`/stock?${params}`),
    placeholderData: keepPreviousData,
    enabled: allowed && warehouse !== '',
  });
  if (!allowed) return <Forbidden />;
  const seeCost = can('costs.read');

  return (
    <>
      <PageHeader
        title="Stock"
        description="Existencias por depósito. Cada cambio queda registrado como un movimiento con motivo y usuario."
        actions={
          <Link to="/app/stock/movimientos" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
            Ver movimientos
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar producto"
          placeholder="Buscar por nombre o escanear un código"
          className="sm:w-80"
          value={search}
          onChange={(e) => (setSearch(e.target.value), setPage(1))}
        />
        {categories.data && (
          <Select aria-label="Categoría" className="sm:w-56" value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPage(1))}>
            <option value="">Todas las categorías</option>
            {categories.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {warehouses.data && warehouses.data.length > 1 && (
          <Select aria-label="Depósito" className="sm:w-64" value={warehouse} onChange={(e) => (setWarehouseId(e.target.value), setPage(1))}>
            {warehouses.data.map((w) => (
              <option key={w.id} value={w.id}>
                {w.branchName} · {w.name}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 rounded border-slate-300" checked={low} onChange={(e) => (setLow(e.target.checked), setPage(1))} />
          Solo bajo el mínimo
        </label>
      </div>
      <Card>
        {(stock.isLoading || warehouses.isLoading) && <Spinner />}
        {(stock.error || warehouses.error) && <div className="p-4"><Alert>{errorMessage(stock.error ?? warehouses.error)}</Alert></div>}
        {stock.data && stock.data.items.length === 0 && (
          <EmptyState>{low ? 'Ningún producto está por debajo de su stock mínimo.' : search || categoryId ? 'Ningún producto coincide con la búsqueda.' : 'Todavía no hay productos que controlen stock.'}</EmptyState>
        )}
        {stock.data && stock.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Producto</Th>
                <Th>Categoría</Th>
                <Th className="text-right">Stock</Th>
                <Th className="text-right">Mínimo</Th>
                {seeCost && <Th className="text-right">Valorizado</Th>}
                <Th className="text-right">Acciones</Th>
              </>
            }
          >
            {stock.data.items.map((r) => (
              <tr key={r.variantId}>
                <Td>
                  <div className="font-medium">{r.name}</div>
                  {r.sku && <div className="text-xs text-slate-500">{r.sku}</div>}
                </Td>
                <Td>{r.categoryName ?? '—'}</Td>
                <Td className="text-right whitespace-nowrap">
                  <span className={dec(r.onHand).lt(0) ? 'font-semibold text-red-700' : r.low ? 'font-semibold text-orange-700' : 'font-semibold'}>
                    {formatQty(r.onHand, r.saleMode)}
                  </span>
                  {r.low && (
                    <span className="ml-2">
                      <Badge tone="amber">Bajo mínimo</Badge>
                    </span>
                  )}
                </Td>
                <Td className="text-right text-slate-600">{r.minStock ? formatQty(r.minStock, r.saleMode) : '—'}</Td>
                {seeCost && (
                  <Td className="text-right whitespace-nowrap text-slate-600">
                    {r.cost && dec(r.onHand).gt(0) ? formatArs(dec(r.cost).times(r.onHand)) : '—'}
                  </Td>
                )}
                <Td className="text-right whitespace-nowrap">
                  {can('stock.adjust') && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ row: r, operation: 'adjust' })}>
                      Ajustar
                    </Button>
                  )}
                  {can('stock.waste') && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ row: r, operation: 'waste' })}>
                      Baja
                    </Button>
                  )}
                  <Link
                    to="/app/stock/movimientos"
                    search={{ productId: r.productId }}
                    className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Movimientos
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {stock.data && <Pager page={page} pageSize={PAGE_SIZE} total={stock.data.total} onPage={setPage} />}
      </Card>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.operation === 'adjust' ? 'Ajustar stock' : 'Baja por merma o vencimiento'}
        description={dialog?.row.name}
      >
        {dialog && <OperationForm key={`${dialog.row.variantId}-${dialog.operation}`} row={dialog.row} warehouseId={warehouse} operation={dialog.operation} onDone={() => setDialog(null)} />}
      </Dialog>
    </>
  );
}
