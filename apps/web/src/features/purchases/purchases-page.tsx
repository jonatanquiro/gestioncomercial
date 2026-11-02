import { createPurchaseSchema, type ItemDto, type Paginated, type PurchaseDto, type SupplierDto, supplierSchema, updateSupplierSchema, variantDisplayName } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid, warehousesQuery, zodFieldErrors } from '@/features/catalog/queries';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatCuit, formatDateTime, formatQty, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';

const PAGE_SIZE = 25;
const suppliersQuery = { queryKey: ['suppliers'], queryFn: () => http.get<SupplierDto[]>('/suppliers') };

/** Compras (ADR 0014): ingresos de mercadería y proveedores. */
export function PurchasesPage() {
  const can = useCan();
  const [tab, setTab] = useState<'purchases' | 'suppliers'>('purchases');
  if (!can('purchases.create', 'purchases.receive', 'suppliers.manage')) return <Forbidden />;
  const canReceive = can('purchases.create', 'purchases.receive');
  const current = canReceive ? tab : 'suppliers';
  return (
    <>
      <PageHeader
        title="Compras"
        description="Mercadería que entra al comercio: suma stock y, si cargás el costo, actualiza los costos."
        actions={
          canReceive && (
            <Link to="/app/compras/nueva" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
              <Plus className="size-4" aria-hidden /> Ingresar mercadería
            </Link>
          )
        }
      />
      {canReceive && can('suppliers.manage') && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
          {(
            [
              ['purchases', 'Ingresos'],
              ['suppliers', 'Proveedores'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={current === key}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${current === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {current === 'purchases' ? <PurchasesList /> : <SuppliersList />}
    </>
  );
}

function PurchasesList() {
  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState('');
  const suppliers = useQuery(suppliersQuery);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (supplierId) params.set('supplierId', supplierId);
  const purchases = useQuery({ queryKey: ['purchases', params.toString()], queryFn: () => http.get<Paginated<PurchaseDto>>(`/purchases?${params}`), placeholderData: keepPreviousData });
  return (
    <>
      <div className="mb-4">
        <Select aria-label="Proveedor" className="sm:w-72" value={supplierId} onChange={(e) => (setSupplierId(e.target.value), setPage(1))}>
          <option value="">Todos los proveedores</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        {purchases.isLoading && <Spinner />}
        {purchases.error && <div className="p-4"><Alert>{errorMessage(purchases.error)}</Alert></div>}
        {purchases.data && purchases.data.items.length === 0 && (
          <EmptyState>{supplierId ? 'No hay ingresos de ese proveedor.' : 'Todavía no registraste ingresos de mercadería. Cuando llegue un pedido, cargalo con «Ingresar mercadería».'}</EmptyState>
        )}
        {purchases.data && purchases.data.items.length > 0 && (
          <Table head={<><Th>N°</Th><Th>Fecha</Th><Th>Proveedor</Th><Th>Comprobante</Th><Th className="text-right">Artículos</Th><Th className="text-right">Costo total</Th><Th>Registró</Th></>}>
            {purchases.data.items.map((p) => (
              <tr key={p.id}>
                <Td>
                  <Link to="/app/compras/$id" params={{ id: p.id }} className="-my-2 inline-flex min-h-10 min-w-10 items-center font-semibold text-brand-700 hover:underline">
                    {p.number}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDateTime(p.createdAt)}</Td>
                <Td>{p.supplierName ?? '—'}</Td>
                <Td>{p.document ?? '—'}</Td>
                <Td className="text-right">{p.lineCount}</Td>
                <Td className="text-right font-semibold">{p.totalCost ? formatArs(p.totalCost) : '—'}</Td>
                <Td>{p.createdByName ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
        {purchases.data && <Pager page={page} pageSize={PAGE_SIZE} total={purchases.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}

function SuppliersList() {
  const can = useCan();
  const suppliers = useQuery(suppliersQuery);
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  return (
    <>
      {can('suppliers.manage') && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Nuevo proveedor
          </Button>
        </div>
      )}
      <Card>
        {suppliers.isLoading && <Spinner />}
        {suppliers.data && suppliers.data.length === 0 && <EmptyState>Todavía no cargaste proveedores.</EmptyState>}
        {suppliers.data && suppliers.data.length > 0 && (
          <Table head={<><Th>Proveedor</Th><Th>CUIT</Th><Th>Contacto</Th><Th>Estado</Th><Th className="text-right">Acciones</Th></>}>
            {suppliers.data.map((s) => (
              <tr key={s.id}>
                <Td>
                  <div className="font-medium">{s.name}</div>
                  {s.notes && <div className="text-xs text-slate-500">{s.notes}</div>}
                </Td>
                <Td>{s.cuit ? formatCuit(s.cuit) : '—'}</Td>
                <Td>{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</Td>
                <Td>{s.status === 'active' ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
                <Td className="text-right">
                  {can('suppliers.manage') && (
                    <Button size="sm" variant="subtle" onClick={() => setEditing(s)}>
                      Editar
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nuevo proveedor' : `Editar ${editing.name}`}>
          <SupplierForm supplier={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        </Dialog>
      )}
    </>
  );
}

function SupplierForm({ supplier, onDone }: { supplier?: SupplierDto; onDone: (saved: SupplierDto) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: supplier?.name ?? '', cuit: supplier?.cuit ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', notes: supplier?.notes ?? '',
    status: supplier?.status ?? 'active',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) => (supplier ? http.put<SupplierDto>(`/suppliers/${supplier.id}`, body) : http.post<SupplierDto>('/suppliers', body)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast(supplier ? 'Proveedor actualizado' : 'Proveedor creado');
      onDone(saved);
    },
    onError: (err) => err instanceof ApiRequestError && setErrors(err.fieldErrors()),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = (supplier ? updateSupplierSchema : supplierSchema).safeParse(form);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    save.mutate(parsed.data);
  }
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      <Field label="Nombre" error={errors.name}>{(p) => <Input {...p} autoFocus value={form.name} onChange={set('name')} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CUIT" error={errors.cuit} hint="Opcional.">{(p) => <Input {...p} value={form.cuit} onChange={set('cuit')} />}</Field>
        <Field label="Teléfono" error={errors.phone} hint="Opcional.">{(p) => <Input {...p} value={form.phone} onChange={set('phone')} />}</Field>
      </div>
      <Field label="Email" error={errors.email} hint="Opcional.">{(p) => <Input {...p} type="email" value={form.email} onChange={set('email')} />}</Field>
      <Field label="Notas" error={errors.notes} hint="Opcional: días de entrega, vendedor, condiciones.">{(p) => <Input {...p} value={form.notes} onChange={set('notes')} />}</Field>
      {supplier && (
        <Field label="Estado">
          {(p) => (
            <Select {...p} value={form.status} onChange={set('status')}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </Select>
          )}
        </Field>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {supplier ? 'Guardar cambios' : 'Crear proveedor'}
        </Button>
      </div>
    </form>
  );
}

interface Row {
  item: ItemDto;
  quantity: string;
  cost: string;
}

/** Carga de un ingreso: proveedor, comprobante y artículos escaneados o buscados, con cantidad y costo. */
export function NewPurchasePage() {
  const can = useCan();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const suppliers = useQuery(suppliersQuery);
  const warehouses = useQuery(warehousesQuery);
  const editCost = can('costs.update');
  const [clientUuid] = useState(newClientUuid);
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState(false);
  const [document, setDocument] = useState('');
  const [notes, setNotes] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [updateCosts, setUpdateCosts] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const warehouse = warehouseId || warehouses.data?.find((w) => w.isDefault)?.id || warehouses.data?.[0]?.id || '';

  const save = useMutation({
    mutationFn: (body: unknown) => http.post<PurchaseDto>('/purchases', body),
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast(`Ingreso N° ${p.number} registrado`);
      void navigate({ to: '/app/compras/$id', params: { id: p.id } });
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors());
      setError(errorMessage(err));
    },
  });

  if (!can('purchases.create', 'purchases.receive')) return <Forbidden />;

  function add(item: ItemDto, factor: string) {
    setRows((list) => {
      const i = list.findIndex((r) => r.item.variantId === item.variantId);
      if (i === -1) return [...list, { item, quantity: toInputDecimal(factor), cost: toInputDecimal(item.cost) }];
      return list.map((r, j) => (j === i ? { ...r, quantity: toInputDecimal(dec(parseDecimalInput(r.quantity) || '0').plus(factor).toFixed(3)) } : r));
    });
  }

  const lines = rows.map((r) => {
    const quantity = parseDecimalInput(r.quantity);
    const unitCost = r.cost.trim() === '' ? null : parseDecimalInput(r.cost);
    const ok = /^\d+(\.\d+)?$/.test(quantity) && (unitCost === null || /^\d+(\.\d+)?$/.test(unitCost));
    return { ...r, quantity, unitCost, subtotal: ok && unitCost !== null ? dec(quantity).times(unitCost).toFixed(2) : null };
  });
  const total = lines.every((l) => l.subtotal !== null) && lines.length > 0 ? lines.reduce((s, l) => s.plus(l.subtotal!), dec(0)).toFixed(2) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      clientUuid,
      warehouseId: warehouse,
      supplierId: supplierId || null,
      document,
      notes,
      updateCosts: editCost && updateCosts,
      lines: lines.map((l) => ({ variantId: l.item.variantId, quantity: l.quantity, unitCost: editCost ? l.unitCost : null })),
    };
    const parsed = createPurchaseSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const activeSuppliers = (suppliers.data ?? []).filter((s) => s.status === 'active');
  return (
    <>
      <PageHeader title="Ingresar mercadería" description="Escaneá o buscá cada artículo que llegó. Al guardar se suma al stock." />
      <form onSubmit={submit} className="space-y-6" noValidate>
        {error && <Alert>{error}</Alert>}
        <Card className="grid gap-4 p-5 md:grid-cols-3">
          <Field label="Proveedor" hint="Opcional.">
            {(p) => (
              <Select {...p} value={supplierId} onChange={(e) => (e.target.value === '__new' ? setNewSupplier(true) : setSupplierId(e.target.value))}>
                <option value="">Sin proveedor</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {can('suppliers.manage') && <option value="__new">+ Nuevo proveedor…</option>}
              </Select>
            )}
          </Field>
          <Field label="Factura o remito" hint="Opcional. Ej.: FC A 0001-00001234">
            {(p) => <Input {...p} value={document} onChange={(e) => setDocument(e.target.value)} maxLength={60} />}
          </Field>
          {(warehouses.data?.length ?? 0) > 1 ? (
            <Field label="Depósito">
              {(p) => (
                <Select {...p} value={warehouse} onChange={(e) => setWarehouseId(e.target.value)}>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.branchName} · {w.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Notas" hint="Opcional.">{(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />}</Field>
        </Card>

        <Card className="p-5">
          <ProductPicker onPick={add} multiplier label="Escaneá o buscá el artículo que llegó" />
          <p className="mt-1.5 text-xs text-slate-500">
            Para cargar varios: escribí <kbd className="rounded border border-slate-300 bg-white px-1 font-sans">24*</kbd> y escaneá. El código de la caja ya suma las unidades que trae.
          </p>
          {rows.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-500">Todavía no cargaste artículos.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2">Artículo</th>
                    <th className="w-28 py-2 pl-3">Cantidad</th>
                    {editCost && <th className="w-36 py-2 pl-3">Costo unitario</th>}
                    {editCost && <th className="py-2 pl-3 text-right">Subtotal</th>}
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => {
                    const name = variantDisplayName(l.item.name, l.item.variantLabel);
                    return (
                      <tr key={l.item.variantId} className="align-top">
                        <td className="py-2 pt-4 font-medium">
                          {name}
                          {l.item.stock !== null && <span className="block text-xs font-normal text-slate-500">Stock actual {formatQty(l.item.stock, l.item.saleMode)}</span>}
                        </td>
                        <td className="py-2 pl-3">
                          <Input aria-label={`Cantidad de ${name}`} inputMode="decimal" className="h-10 text-right" value={rows[i]!.quantity} aria-invalid={errors[`lines.${i}.quantity`] ? true : undefined} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))} />
                          {errors[`lines.${i}.quantity`] && <p className="mt-1 text-xs text-red-600">{errors[`lines.${i}.quantity`]}</p>}
                        </td>
                        {editCost && (
                          <td className="py-2 pl-3">
                            <Input aria-label={`Costo de ${name}`} inputMode="decimal" className="h-10 text-right" placeholder="Sin cargar" value={rows[i]!.cost} aria-invalid={errors[`lines.${i}.unitCost`] ? true : undefined} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, cost: e.target.value } : r)))} />
                            {l.item.cost && l.unitCost && !dec(l.item.cost).eq(l.unitCost) && /^\d+(\.\d+)?$/.test(l.unitCost) && (
                              <span className={`mt-1 block text-xs ${dec(l.unitCost).gt(l.item.cost) ? 'text-orange-700' : 'text-emerald-700'}`}>
                                Antes {formatArs(l.item.cost)}
                              </span>
                            )}
                          </td>
                        )}
                        {editCost && <td className="py-2 pl-3 pt-4 text-right font-semibold">{l.subtotal ? formatArs(l.subtotal) : '—'}</td>}
                        <td className="py-2 pl-2">
                          <Button variant="ghost" className="h-10" aria-label={`Quitar ${name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-sm">
            {editCost && (
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 rounded border-slate-300" checked={updateCosts} onChange={(e) => setUpdateCosts(e.target.checked)} />
                Actualizar el costo de los artículos con los de esta compra
              </label>
            )}
            {editCost && total && <p className="text-lg">Total de la compra: <span className="font-bold">{formatArs(total)}</span></p>}
          </div>
          <Button type="submit" className="h-12 px-6" loading={save.isPending} disabled={rows.length === 0}>
            Registrar ingreso
          </Button>
        </div>
      </form>
      {newSupplier && (
        <Dialog open onOpenChange={(o) => !o && setNewSupplier(false)} title="Nuevo proveedor">
          <SupplierForm onDone={(s) => (setSupplierId(s.id), setNewSupplier(false))} />
        </Dialog>
      )}
    </>
  );
}

export function PurchaseDetailPage() {
  const { id } = useParams({ from: '/app/compras/$id' });
  const can = useCan();
  const purchase = useQuery({ queryKey: ['purchases', 'detail', id], queryFn: () => http.get<PurchaseDto>(`/purchases/${id}`) });
  if (!can('purchases.create', 'purchases.receive')) return <Forbidden />;
  if (purchase.isLoading) return <Spinner />;
  if (purchase.error) return <Alert>{errorMessage(purchase.error)}</Alert>;
  const p = purchase.data!;
  const seeCost = can('costs.read');
  return (
    <>
      <PageHeader
        title={`Ingreso N° ${p.number}`}
        description={[formatDateTime(p.createdAt), p.supplierName, p.document, p.warehouseName, p.createdByName && `Registró ${p.createdByName}`].filter(Boolean).join(' · ')}
        actions={
          <Link to="/app/compras" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold hover:bg-slate-50">
            Volver a compras
          </Link>
        }
      />
      {p.updatedCosts && seeCost && can('prices.bulk_update') && (
        <div className="mb-4">
          <Alert kind="info">
            Con este ingreso se actualizaron los costos. Si querés mantener tu margen,{' '}
            <Link to="/app/precios" className="font-semibold underline">
              ajustá los precios con un recargo sobre el costo
            </Link>
            .
          </Alert>
        </div>
      )}
      <Card>
        <Table head={<><Th>Artículo</Th><Th className="text-right">Cantidad</Th>{seeCost && <Th className="text-right">Costo unitario</Th>}{seeCost && <Th className="text-right">Subtotal</Th>}</>}>
          {(p.lines ?? []).map((l) => (
            <tr key={l.variantId}>
              <Td className="font-medium">{l.description}</Td>
              <Td className="text-right">{formatQty(l.quantity)}</Td>
              {seeCost && <Td className="text-right">{l.unitCost ? formatArs(l.unitCost) : '—'}</Td>}
              {seeCost && <Td className="text-right font-semibold">{l.unitCost ? formatArs(dec(l.quantity).times(l.unitCost).toFixed(2)) : '—'}</Td>}
            </tr>
          ))}
        </Table>
        {seeCost && p.totalCost && <p className="border-t border-slate-200 px-4 py-3 text-right text-lg">Total <span className="font-bold">{formatArs(p.totalCost)}</span></p>}
        {p.notes && <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600">{p.notes}</p>}
      </Card>
    </>
  );
}
