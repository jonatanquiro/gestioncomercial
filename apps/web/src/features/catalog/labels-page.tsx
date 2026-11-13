import { type ItemDto, type Paginated, type ProductDto, type PurchaseDto, variantDisplayName } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { ListPlus, Printer, Trash2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Forbidden } from '@/features/layout/app-layout';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { BarcodeSvg } from '@/components/barcode-svg';
import { formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { itemOf } from './item';
import {
  CUSTOM, type LabelContent, type LabelLayout, type LabelSettings, PAPER_SIZE, PRESETS, fontScale, layoutErrors, loadSettings, pageSize, paginate, perPage, saveSettings, slotPosition,
} from './label-layout';
import { categoriesQuery, tenantQuery } from './queries';

interface Row {
  item: ItemDto;
  copies: string;
}

/** Topes para que la página no se cuelgue: artículos en la lista y etiquetas por impresión. */
const MAX_ROWS = 3000;
const MAX_LABELS = 5000;
/** Milímetros a píxeles de pantalla (96 ppp). */
const PX_PER_MM = 96 / 25.4;

/**
 * Etiquetas con código de barras (ADR 0014 y 0028): de a uno, por categoría o desde un ingreso de
 * mercadería; en rollo térmico o en hojas autoadhesivas A4/Carta con medidas configurables. Lo
 * que no tiene código recibe uno interno, así se vende escaneando en lugar de buscando.
 */
export function LabelsPage() {
  const can = useCan();
  const toast = useToast();
  const { productId, purchaseId } = useSearch({ from: '/app/etiquetas' });
  const tenant = useQuery(tenantQuery);
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettingsState] = useState<LabelSettings>(loadSettings);
  const [skip, setSkip] = useState('1');
  const [bulk, setBulk] = useState(false);
  const [printing, setPrinting] = useState(false);
  const loaded = useRef<string | null>(null);

  function setSettings(next: LabelSettings) {
    setSettingsState(next);
    saveSettings(next);
  }

  // Desde Productos → «Imprimir etiquetas»: todas las variantes, una etiqueta por unidad en stock.
  const product = useQuery({ queryKey: ['products', productId], queryFn: () => http.get<ProductDto>(`/products/${productId}`), enabled: !!productId });
  useEffect(() => {
    if (!product.data || loaded.current === product.data.id) return;
    loaded.current = product.data.id;
    setRows(product.data.variants.map((v) => ({ item: itemOf(product.data!, v), copies: copiesFor(itemOf(product.data!, v)) })));
  }, [product.data]);

  // Desde un ingreso de mercadería: una etiqueta por unidad que entró.
  const purchase = useQuery({ queryKey: ['labels', 'purchase', purchaseId], queryFn: () => purchaseRows(purchaseId!), enabled: !!purchaseId });
  useEffect(() => {
    if (!purchase.data || loaded.current === purchaseId) return;
    loaded.current = purchaseId!;
    setRows(purchase.data);
  }, [purchase.data, purchaseId]);

  const generate = useMutation({
    mutationFn: async (variantIds: string[]) => {
      let generated = 0;
      const items: ItemDto[] = [];
      for (let i = 0; i < variantIds.length; i += 500) {
        const res = await http.post<{ generated: number; items: ItemDto[] }>('/products/barcodes', { variantIds: variantIds.slice(i, i + 500) });
        generated += res.generated;
        items.push(...res.items);
      }
      return { generated, items };
    },
    onSuccess: (res) => {
      const byId = new Map(res.items.map((i) => [i.variantId, i]));
      setRows((list) => list.map((r) => ({ ...r, item: byId.get(r.item.variantId) ?? r.item })));
      toast(res.generated === 1 ? 'Se generó 1 código' : `Se generaron ${res.generated} códigos`);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (!can('products.read')) return <Forbidden />;
  const { layout, content } = settings;
  const errors = layoutErrors(layout);
  const withoutCode = rows.filter((r) => r.item.barcodes.length === 0);
  const requested = rows.reduce((n, r) => n + copiesOf(r), 0);
  const labels = expand(rows, MAX_LABELS);
  const size = perPage(layout);
  const skipped = layout.medium === 'sheet' ? Math.min(size - 1, Math.max(0, (Number.parseInt(skip, 10) || 1) - 1)) : 0;
  const pages = paginate(labels, layout, skipped);
  const free = pages.length ? pages[pages.length - 1]!.filter((s) => s === null).length - (pages.length === 1 ? skipped : 0) : 0;
  const store = content.showStore ? tenant.data?.tradeName : undefined;

  function add(items: ItemDto[], copies: (i: ItemDto) => string) {
    const seen = new Set(rows.map((r) => r.item.variantId));
    const fresh = items.filter((i) => !seen.has(i.variantId) && seen.add(i.variantId)).map((item) => ({ item, copies: copies(item) }));
    if (rows.length + fresh.length > MAX_ROWS) toast(`La lista admite hasta ${MAX_ROWS} artículos; imprimí estos y después seguí con el resto`, 'error');
    setRows([...rows, ...fresh].slice(0, MAX_ROWS));
  }

  /** Agrega copias del último artículo hasta llenar la última hoja. */
  function fillSheet() {
    const last = rows.length - 1;
    if (last < 0 || free <= 0) return;
    setRows(rows.map((r, i) => (i === last ? { ...r, copies: String(copiesOf(r) + free) } : r)));
  }

  const unit = layout.medium === 'sheet' ? (pages.length === 1 ? 'hoja' : 'hojas') : null;
  return (
    <>
      <PageHeader
        title="Etiquetas"
        description="Imprimí etiquetas con código de barras y precio, en impresora térmica o en hojas autoadhesivas. Lo que no tiene código recibe uno interno para venderlo escaneando."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <ProductPicker onlyStock={false} onPick={(item) => add([item], () => '1')} label="Escaneá o buscá un artículo para etiquetar" />
            </div>
            <Button variant="secondary" onClick={() => setBulk(true)}>
              <ListPlus className="size-4" aria-hidden /> Agregar varios
            </Button>
          </div>
          {product.error && <div className="mt-3"><Alert>{errorMessage(product.error)}</Alert></div>}
          {purchase.error && <div className="mt-3"><Alert>{errorMessage(purchase.error)}</Alert></div>}
          {(product.isLoading || purchase.isLoading) && <p className="mt-4 text-sm text-slate-500">Cargando artículos…</p>}
          {rows.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-500">
              Agregá artículos de a uno, usá «Agregar varios» para cargar una categoría entera o lo que tiene stock, o entrá desde un ingreso de mercadería → «Imprimir etiquetas».
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="mr-auto text-slate-600">
                  {rows.length === 1 ? '1 artículo' : `${rows.length} artículos`} · {requested === 1 ? '1 etiqueta' : `${requested} etiquetas`}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setRows(rows.map((r) => ({ ...r, copies: copiesFor(r.item) })))}>
                  Una por unidad en stock
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRows(rows.map((r) => ({ ...r, copies: '1' })))}>
                  Una de cada uno
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRows([])}>
                  Vaciar la lista
                </Button>
              </div>
              <div className="mt-2 max-h-[34rem] overflow-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2">Artículo</th>
                      <th className="py-2">Código</th>
                      <th className="w-24 py-2 pl-3">Etiquetas</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => {
                      const name = variantDisplayName(r.item.name, r.item.variantLabel);
                      return (
                        <tr key={r.item.variantId}>
                          <td className="py-2 font-medium">
                            {name}
                            <span className="block text-xs font-normal text-slate-500">
                              {formatArs(r.item.price)}
                              {r.item.stock !== null && ` · stock ${formatQty(r.item.stock, r.item.saleMode)}`}
                            </span>
                          </td>
                          <td className="py-2">{r.item.barcodes[0]?.code ?? <Badge tone="amber">Sin código</Badge>}</td>
                          <td className="py-2 pl-3">
                            <Input aria-label={`Etiquetas de ${name}`} inputMode="numeric" className="h-9 text-right" value={r.copies} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, copies: e.target.value.replace(/\D/g, '').slice(0, 4) } : x)))} />
                          </td>
                          <td className="py-2 pl-2">
                            <Button variant="ghost" size="sm" aria-label={`Quitar ${name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="space-y-4 p-5">
            <FormatSettings settings={settings} onChange={setSettings} />
            {layout.medium === 'sheet' && errors.length === 0 && (
              <Field label="Empezar en la etiqueta n°" hint={`Para aprovechar una hoja ya usada: de izquierda a derecha y de arriba abajo, del 1 al ${size}.`}>
                {(p) => <Input {...p} inputMode="numeric" value={skip} onChange={(e) => setSkip(e.target.value.replace(/\D/g, '').slice(0, 3))} />}
              </Field>
            )}
            {errors.length > 0 && <Alert>{errors.join('. ')}.</Alert>}
          </Card>

          <Card className="h-fit space-y-4 p-5">
            {withoutCode.length > 0 && (
              <Alert kind="info">
                {withoutCode.length === 1 ? '1 artículo no tiene' : `${withoutCode.length} artículos no tienen`} código de barras.
                {can('products.update') ? (
                  <Button size="sm" variant="secondary" className="mt-2 w-full" loading={generate.isPending} onClick={() => generate.mutate(withoutCode.map((r) => r.item.variantId))}>
                    Generar códigos internos
                  </Button>
                ) : (
                  ' Pedile a un encargado que les genere uno.'
                )}
              </Alert>
            )}
            {requested > MAX_LABELS && <Alert>Se imprimen hasta {MAX_LABELS} etiquetas por vez. Bajá las cantidades o imprimí en tandas.</Alert>}
            {labels.length > 0 && errors.length === 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Vista previa{unit && ` · ${pages.length} ${unit}`}
                </p>
                <PagePreview page={pages[0]!} settings={settings} store={store} />
                {unit && free > 0 && (
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span>{free === 1 ? 'Queda 1 lugar libre' : `Quedan ${free} lugares libres`} en la última hoja.</span>
                    <Button size="sm" variant="ghost" onClick={fillSheet}>
                      Completar la hoja
                    </Button>
                  </div>
                )}
              </div>
            )}
            <Button className="h-12 w-full" disabled={labels.length === 0 || withoutCode.length > 0 || errors.length > 0} onClick={() => setPrinting(true)}>
              <Printer className="size-4" aria-hidden /> Imprimir {labels.length === 1 ? '1 etiqueta' : `${labels.length} etiquetas`}
            </Button>
            {withoutCode.length > 0 && labels.length > 0 && <p className="text-xs text-slate-500">Primero generá los códigos que faltan.</p>}
            <p className="text-xs text-slate-500">
              En la ventana de impresión elegí la impresora de etiquetas, el tamaño de papel {layout.medium === 'roll' ? `${fmtMm(pageSize(layout).width)} × ${fmtMm(layout.height)} mm` : PAPER_SIZE[layout.paper].label}, márgenes «Ninguno» y escala 100%.
            </p>
          </Card>
        </div>
      </div>
      {bulk && <BulkAdd onClose={() => setBulk(false)} onAdd={add} />}
      {printing && <PrintLabels pages={pages} settings={settings} store={store} onDone={() => setPrinting(false)} />}
    </>
  );
}

const copiesOf = (r: Row) => Math.max(0, Number.parseInt(r.copies, 10) || 0);

/** Una etiqueta por unidad en stock; lo que se vende por peso o medida, una sola. */
function copiesFor(item: ItemDto): string {
  if (item.saleMode !== 'unit' || item.stock === null || !dec(item.stock).gt(0)) return '1';
  return String(Math.min(9999, Math.ceil(Number(item.stock))));
}

function expand(rows: Row[], max: number): ItemDto[] {
  const out: ItemDto[] = [];
  for (const r of rows) {
    for (let n = copiesOf(r); n > 0 && out.length < max; n--) out.push(r.item);
  }
  return out;
}

const fmtMm = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

/** Artículos de un ingreso de mercadería, con tantas etiquetas como unidades entraron. */
async function purchaseRows(id: string): Promise<Row[]> {
  const p = await http.get<PurchaseDto>(`/purchases/${id}`);
  const lines = p.lines ?? [];
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const items: ItemDto[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const page = await http.get<Paginated<ItemDto>>(`/products/items?pageSize=100&variantIds=${ids.slice(i, i + 100).join(',')}`);
    items.push(...page.items);
  }
  const byId = new Map(items.map((i) => [i.variantId, i]));
  const qty = new Map<string, number>();
  for (const l of lines) qty.set(l.variantId, (qty.get(l.variantId) ?? 0) + Number(l.quantity));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    return [{ item, copies: item.saleMode === 'unit' ? String(Math.min(9999, Math.ceil(qty.get(id) ?? 1))) : '1' }];
  });
}

function FormatSettings({ settings, onChange }: { settings: LabelSettings; onChange: (s: LabelSettings) => void }) {
  const { layout, content } = settings;
  const [open, setOpen] = useState(settings.preset === CUSTOM);
  const setLayout = (patch: Partial<LabelLayout>) => onChange({ ...settings, preset: CUSTOM, layout: { ...layout, ...patch } });
  const setContent = (patch: Partial<LabelContent>) => onChange({ ...settings, content: { ...content, ...patch } });
  const num = (key: keyof LabelLayout, label: string, opts: { int?: boolean } = {}) => (
    <NumberField label={label} value={layout[key] as number} int={opts.int} onChange={(v) => setLayout({ [key]: v })} />
  );

  function choose(id: string) {
    if (id === CUSTOM) return (onChange({ ...settings, preset: CUSTOM }), setOpen(true));
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) onChange({ ...settings, preset: id, layout: preset.layout });
  }

  return (
    <>
      <Field label="Formato">
        {(p) => (
          <Select {...p} value={settings.preset} onChange={(e) => choose(e.target.value)}>
            <optgroup label="Impresora térmica (rollo)">
              {PRESETS.filter((x) => x.layout.medium === 'roll').map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </optgroup>
            <optgroup label="Impresora común (hoja autoadhesiva)">
              {PRESETS.filter((x) => x.layout.medium === 'sheet').map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </optgroup>
            <option value={CUSTOM}>Otra medida (personalizada)</option>
          </Select>
        )}
      </Field>
      <button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Ocultar medidas' : 'Ajustar medidas y calibrar'}
      </button>
      {open && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Impresora">
              {(p) => (
                <Select {...p} value={layout.medium} onChange={(e) => setLayout(e.target.value === 'roll' ? { medium: 'roll', rows: 1, marginTop: 0, gapY: 0 } : { medium: 'sheet', rows: Math.max(layout.rows, 8) })}>
                  <option value="roll">Térmica (rollo)</option>
                  <option value="sheet">Común (hoja)</option>
                </Select>
              )}
            </Field>
            {layout.medium === 'sheet' ? (
              <Field label="Hoja">
                {(p) => (
                  <Select {...p} value={layout.paper} onChange={(e) => setLayout({ paper: e.target.value as LabelLayout['paper'] })}>
                    <option value="A4">A4</option>
                    <option value="Letter">Carta</option>
                  </Select>
                )}
              </Field>
            ) : (
              num('columns', 'Columnas', { int: true })
            )}
            {num('width', 'Ancho etiqueta (mm)')}
            {num('height', 'Alto etiqueta (mm)')}
            {layout.medium === 'sheet' && num('columns', 'Columnas', { int: true })}
            {layout.medium === 'sheet' && num('rows', 'Filas', { int: true })}
            {layout.medium === 'sheet' && num('marginTop', 'Margen arriba (mm)')}
            {num('marginLeft', layout.medium === 'sheet' ? 'Margen izquierdo (mm)' : 'Borde del rollo (mm)')}
            {(layout.columns > 1 || layout.medium === 'sheet') && num('gapX', 'Separación entre columnas (mm)')}
            {layout.medium === 'sheet' && num('gapY', 'Separación entre filas (mm)')}
          </div>
          <p className="text-xs text-slate-500">Si sale corrido, mové todo unos milímetros (con signo menos va a la izquierda o hacia arriba):</p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Correr a la derecha (mm)" value={settings.offsetX} signed onChange={(v) => onChange({ ...settings, offsetX: v })} />
            <NumberField label="Correr hacia abajo (mm)" value={settings.offsetY} signed onChange={(v) => onChange({ ...settings, offsetY: v })} />
          </div>
          <Check checked={content.outline} onChange={(v) => setContent({ outline: v })}>
            Dibujar el contorno de cada etiqueta (para probar en una hoja común antes de gastar etiquetas)
          </Check>
          <p className="text-xs text-slate-500">La configuración queda guardada en esta compu.</p>
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Qué muestra la etiqueta</legend>
        <Check checked={content.showPrice} onChange={(v) => setContent({ showPrice: v })}>Precio</Check>
        {content.showPrice && <Check checked={content.showCashPrice} onChange={(v) => setContent({ showCashPrice: v })}>Precio de contado (si el artículo tiene)</Check>}
        <Check checked={content.showStore} onChange={(v) => setContent({ showStore: v })}>Nombre del comercio</Check>
      </fieldset>
    </>
  );
}

function NumberField({ label, value, onChange, int, signed }: { label: string; value: number; onChange: (v: number) => void; int?: boolean; signed?: boolean }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  // Si cambia desde afuera (otro formato), se muestra el valor nuevo.
  useEffect(() => {
    setText((t) => (Number(t.replace(',', '.')) === value ? t : String(value).replace('.', ',')));
  }, [value]);
  return (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          inputMode="decimal"
          className="h-9 bg-white"
          value={text}
          onChange={(e) => {
            const pattern = int ? /[^\d]/g : signed ? /[^\d,.-]/g : /[^\d,.]/g;
            const t = e.target.value.replace(pattern, '').slice(0, 7);
            setText(t);
            const n = Number(t.replace(',', '.'));
            if (t !== '' && t !== '-' && Number.isFinite(n)) onChange(n);
          }}
        />
      )}
    </Field>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-slate-300" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Carga muchos artículos de una vez: una categoría, una búsqueda o todo lo que tiene stock. */
function BulkAdd({ onClose, onAdd }: { onClose: () => void; onAdd: (items: ItemDto[], copies: (i: ItemDto) => string) => void }) {
  const can = useCan();
  const toast = useToast();
  const categories = useQuery(categoriesQuery);
  const seeStock = can('stock.read');
  const [form, setForm] = useState({ categoryId: '', q: '', onlyStock: seeStock, perUnit: seeStock });
  const [progress, setProgress] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: async () => {
      const items: ItemDto[] = [];
      const params = new URLSearchParams({ pageSize: '100', status: 'active' });
      if (form.categoryId) params.set('categoryId', form.categoryId);
      if (form.q.trim()) params.set('q', form.q.trim());
      for (let page = 1; ; page++) {
        params.set('page', String(page));
        const res = await http.get<Paginated<ProductDto>>(`/products?${params.toString()}`);
        for (const p of res.items) {
          if (p.kind !== 'good') continue;
          for (const v of p.variants) {
            const item = itemOf(p, v);
            if (!form.onlyStock || (item.stock !== null && dec(item.stock).gt(0))) items.push(item);
          }
        }
        setProgress(`Leyendo productos… ${Math.min(res.total, page * 100)} de ${res.total}`);
        if (page * 100 >= res.total || items.length >= MAX_ROWS) break;
      }
      return items;
    },
    onSuccess: (items) => {
      if (items.length === 0) return setProgress('No hay artículos con esos filtros.');
      onAdd(items, form.perUnit ? copiesFor : () => '1');
      toast(items.length === 1 ? 'Se agregó 1 artículo' : `Se agregaron ${items.length} artículos`);
      onClose();
    },
    onError: () => setProgress(null),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setProgress(null);
    load.mutate();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !load.isPending && onClose()} title="Agregar varios artículos" description="Cargá de una vez una categoría entera, lo que coincide con una búsqueda o todo lo que tiene stock.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {load.error && <Alert>{errorMessage(load.error)}</Alert>}
        <Field label="Categoría">
          {(p) => (
            <Select {...p} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Todas</option>
              {(categories.data ?? []).filter((c) => c.status === 'active').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Que el nombre contenga (opcional)" hint="Por ejemplo «remera» o «jean».">
          {(p) => <Input {...p} maxLength={100} value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />}
        </Field>
        {seeStock && (
          <>
            <Check checked={form.onlyStock} onChange={(v) => setForm({ ...form, onlyStock: v })}>Solo los que tienen stock</Check>
            <Check checked={form.perUnit} onChange={(v) => setForm({ ...form, perUnit: v })}>Una etiqueta por unidad en stock (si no, una de cada uno)</Check>
          </>
        )}
        {progress && <p className="text-sm text-slate-600">{progress}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={load.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={load.isPending}>
            Agregar a la lista
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Label({ item, layout, content, store }: { item: ItemDto; layout: LabelLayout; content: LabelContent; store?: string }) {
  const code = item.barcodes[0]?.code ?? '';
  const k = fontScale(layout);
  const pt = (n: number) => `${(n * k).toFixed(2)}pt`;
  const roomy = layout.height >= 30;
  return (
    <div
      className="label flex flex-col overflow-hidden text-black"
      style={{ background: '#fff', color: '#000', width: `${layout.width}mm`, height: `${layout.height}mm`, padding: `${(1.5 * k).toFixed(2)}mm ${(2 * k).toFixed(2)}mm`, outline: content.outline ? '0.2mm dashed #888' : undefined, outlineOffset: '-0.2mm' }}
    >
      {store && <div className="truncate uppercase tracking-wider" style={{ fontSize: pt(5.5) }}>{store}</div>}
      <div className={`${roomy ? 'line-clamp-2' : 'line-clamp-1'} font-semibold leading-tight`} style={{ fontSize: pt(7.5) }}>{item.name}</div>
      <div className="flex items-baseline justify-between gap-1 leading-tight">
        <span className="truncate font-bold" style={{ fontSize: pt(8) }}>{item.variantLabel ?? ''}</span>
        {content.showPrice && <span className="shrink-0 font-bold" style={{ fontSize: pt(10) }}>{formatArs(item.price)}</span>}
      </div>
      {content.showPrice && content.showCashPrice && item.cashPrice && <div className="text-right font-semibold leading-tight" style={{ fontSize: pt(7) }}>Contado {formatArs(item.cashPrice)}</div>}
      <BarcodeSvg code={code} className="mt-auto min-h-0 w-full flex-1" />
      <div className="text-center font-mono leading-none tracking-[0.15em]" style={{ fontSize: pt(6.5) }}>{code}</div>
    </div>
  );
}

/** Una página (fila del rollo u hoja) con cada etiqueta en su lugar exacto, en milímetros. */
function Page({ slots, settings, store }: { slots: Array<ItemDto | null>; settings: LabelSettings; store?: string }) {
  const { layout, content } = settings;
  const page = pageSize(layout);
  return (
    <div className="labels-page relative overflow-hidden" style={{ background: '#fff', width: `${page.width}mm`, height: `${page.height}mm` }}>
      {slots.map((item, i) => {
        const pos = slotPosition(layout, i, settings.offsetX, settings.offsetY);
        return item ? (
          <div key={i} className="absolute" style={{ left: `${pos.left}mm`, top: `${pos.top}mm` }}>
            <Label item={item} layout={layout} content={content} store={store} />
          </div>
        ) : null;
      })}
    </div>
  );
}

/** La primera página achicada para que entre en la columna; los lugares libres se ven punteados. */
function PagePreview({ page, settings, store }: { page: Array<ItemDto | null>; settings: LabelSettings; store?: string }) {
  const { layout } = settings;
  const size = pageSize(layout);
  const box = layout.medium === 'sheet' ? 280 : Math.min(280, size.width * PX_PER_MM * 1.6);
  const scale = box / (size.width * PX_PER_MM);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-2">
      <div className="relative mx-auto shadow-sm" style={{ width: size.width * PX_PER_MM * scale, height: size.height * PX_PER_MM * scale }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
          <Page slots={page} settings={settings} store={store} />
          {page.map((item, i) => {
            if (item) return null;
            const pos = slotPosition(layout, i, settings.offsetX, settings.offsetY);
            return <div key={i} className="absolute border border-dashed border-slate-300" style={{ left: `${pos.left}mm`, top: `${pos.top}mm`, width: `${layout.width}mm`, height: `${layout.height}mm` }} />;
          })}
        </div>
      </div>
    </div>
  );
}

/** Imprime todas las páginas con la medida exacta de papel; al terminar avisa. */
function PrintLabels({ pages, settings, store, onDone }: { pages: Array<Array<ItemDto | null>>; settings: LabelSettings; store?: string; onDone: () => void }) {
  const size = pageSize(settings.layout);
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener('afterprint', after, { once: true });
    const t = window.setTimeout(() => window.print(), 150);
    return () => (window.clearTimeout(t), window.removeEventListener('afterprint', after));
  }, [onDone]);
  return createPortal(
    <div id="print-root" className="labels">
      <style>{`@media print { @page { size: ${size.width}mm ${size.height}mm; margin: 0; } #print-root.labels { width: auto; } }`}</style>
      {pages.map((slots, i) => (
        <Page key={i} slots={slots} settings={settings} store={store} />
      ))}
    </div>,
    document.body,
  );
}
