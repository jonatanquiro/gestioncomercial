import {
  createProductSchema,
  type ProductDto,
  type ReferenceProductDto,
  SALE_MODE_LABELS,
  SALE_MODES,
  type SaleMode,
  updateProductSchema,
  VAT_RATE_LABELS,
  VAT_RATES,
  type VatRate,
} from '@gc/contracts';
import { dec, marginPercentOf, markupPercentOf } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatPercent, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { brandsQuery, categoriesQuery, tenantQuery, zodFieldErrors } from './queries';
import { emptyRow, rowsFrom, valuesFrom, type VariantRow, VariantsEditor, type VariantsState } from './variants-editor';

interface FormState {
  kind: 'good' | 'service';
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  saleMode: SaleMode;
  vatRate: VatRate;
  trackStock: boolean;
  minStock: string;
  blockNegativeStock: boolean;
  /** Talles, colores u otras propiedades (ADR 0013). Sin ellas, la única variante se edita como antes. */
  hasVariants: boolean;
  variants: VariantsState;
}

function initialState(p?: ProductDto): FormState {
  return {
    kind: p?.kind ?? 'good',
    name: p?.name ?? '',
    description: p?.description ?? '',
    categoryId: p?.categoryId ?? '',
    brandId: p?.brandId ?? '',
    saleMode: p?.saleMode ?? 'unit',
    vatRate: p?.vatRate ?? '21',
    trackStock: p?.trackStock ?? true,
    minStock: toInputDecimal(p?.minStock),
    blockNegativeStock: p?.blockNegativeStock ?? false,
    hasVariants: (p?.optionNames.length ?? 0) > 0,
    variants: p ? { optionNames: p.optionNames, optionValues: valuesFrom(p.optionNames, rowsFrom(p)), rows: rowsFrom(p) } : { optionNames: [], optionValues: [], rows: [{ ...emptyRow(), barcodes: [{ code: '', quantityFactor: '1' }] }] },
  };
}

const UNIT_NAMES: Record<SaleMode, string> = { unit: 'unidades', weight: 'kilos', length: 'metros', volume: 'litros' };

const orNull = (v: string) => (v.trim() === '' ? null : parseDecimalInput(v));

/** Recargo y margen del precio que se está cargando, para decidir sin calculadora. */
function MarginHint({ cost, price }: { cost: string; price: string }) {
  const c = orNull(cost);
  const p = orNull(price);
  if (!c || !p || !/^\d+(\.\d+)?$/.test(c) || !/^\d+(\.\d+)?$/.test(p) || dec(c).isZero() || dec(p).isZero()) return null;
  return (
    <p className="text-xs text-slate-600">
      Recargo sobre el costo {formatPercent(markupPercentOf(c, p))} · Margen sobre el precio {formatPercent(marginPercentOf(c, p))}
    </p>
  );
}

export function ProductForm({ product, onDone }: { product?: ProductDto; onDone: (saved: ProductDto) => void }) {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery);
  const brands = useQuery(brandsQuery);
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<ReferenceProductDto | null>(null);
  const editing = product !== undefined;
  const seeCost = can('costs.read');
  const editCost = can('costs.update');
  const editPrice = !editing || can('prices.update');
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const tenant = useQuery(tenantQuery);
  const variantsAllowed = (tenant.data?.plan?.features ?? []).includes('variants') || form.hasVariants;
  /** Producto sin propiedades: los campos de precio, códigos y stock son los de su única variante. */
  const single = form.variants.rows[0] ?? emptyRow();
  const setSingle = (patch: Partial<VariantRow>) =>
    setForm((f) => ({ ...f, variants: { ...f.variants, rows: [{ ...(f.variants.rows[0] ?? emptyRow()), ...patch }, ...f.variants.rows.slice(1)] } }));
  function toggleVariants(on: boolean) {
    setForm((f) => ({
      ...f,
      hasVariants: on,
      variants: on
        ? { optionNames: ['Talle'], optionValues: [''], rows: f.variants.rows.filter((r) => r.id !== null) }
        : { optionNames: [], optionValues: [], rows: [{ ...(f.variants.rows[0] ?? emptyRow()), options: [] }] },
    }));
  }

  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? http.put<ProductDto>(`/products/${product.id}`, body) : http.post<ProductDto>('/products', body)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast(editing ? 'Cambios guardados' : 'Producto creado');
      onDone(saved);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors());
      setError(errorMessage(err));
    },
  });

  const addBrand = useMutation({
    mutationFn: (name: string) => http.post<{ id: string; name: string }>('/brands', { name }),
    onSuccess: async (brand) => {
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      set('brandId', brand.id);
      setNewBrand(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  /**
   * En un alta, al escanear un código que el comercio no tiene se completan nombre y marca con el
   * catálogo de referencia (SEPA). Solo si el nombre está vacío: nunca pisa lo que se escribió.
   */
  async function suggestFrom(code: string) {
    if (editing || form.hasVariants || form.name.trim() !== '' || !/^\d{8,14}$/.test(code.trim())) return;
    let ref: ReferenceProductDto;
    try {
      ref = await http.get<ReferenceProductDto>(`/products/reference?code=${encodeURIComponent(code.trim())}`);
    } catch {
      return; // Sin sugerencia: se carga a mano como siempre.
    }
    setForm((f) => {
      if (f.name.trim() !== '') return f;
      const brand = ref.brandName ? (brands.data ?? []).find((b) => b.name.toLowerCase() === ref.brandName!.toLowerCase()) : undefined;
      return { ...f, name: ref.name, brandId: brand?.id ?? f.brandId };
    });
    if (ref.brandName && !(brands.data ?? []).some((b) => b.name.toLowerCase() === ref.brandName!.toLowerCase()) && !form.brandId) {
      setNewBrand(ref.brandName);
    }
    setSuggested(ref);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const isService = form.kind === 'service';
    const body = {
      kind: form.kind,
      name: form.name,
      description: form.description,
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      saleMode: form.saleMode,
      vatRate: form.vatRate,
      trackStock: !isService && form.trackStock,
      minStock: isService ? null : orNull(form.minStock),
      blockNegativeStock: form.blockNegativeStock,
      optionNames: form.hasVariants ? form.variants.optionNames : [],
      variants: form.variants.rows.map((r) => ({
        id: r.id,
        options: form.hasVariants ? r.options : [],
        sku: r.sku,
        price: parseDecimalInput(r.price),
        // Quien no ve costos no los manda: el servidor conserva los vigentes.
        cost: seeCost ? orNull(r.cost) : null,
        barcodes: r.barcodes
          .filter((b) => b.code.trim() !== '')
          .map((b) => ({ code: b.code.trim(), quantityFactor: parseDecimalInput(b.quantityFactor || '1') })),
        initialStock: r.id === null && !isService && form.trackStock ? orNull(r.initialStock) : null,
      })),
      ...(editing ? { version: product.version } : {}),
    };
    const parsed = (editing ? updateProductSchema : createProductSchema).safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const activeCategories = (categories.data ?? []).filter((c) => c.status === 'active' || c.id === form.categoryId);
  const unit = UNIT_NAMES[form.saleMode];

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <Alert>{error}</Alert>}
      {suggested && (
        <Alert kind="info">
          Completamos los datos con el catálogo de Precios Claros{suggested.presentation ? ` (${suggested.presentation})` : ''}. Revisalos y poné tu precio.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Nombre" error={errors.name}>
            {(p) => <Input {...p} autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
        </div>
        <Field label="Tipo" error={errors.kind}>
          {(p) => (
            <Select {...p} value={form.kind} onChange={(e) => set('kind', e.target.value as FormState['kind'])} disabled={editing}>
              <option value="good">Producto</option>
              <option value="service">Servicio</option>
            </Select>
          )}
        </Field>
        <Field label="Categoría" error={errors.categoryId}>
          {(p) => (
            <Select {...p} value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Sin categoría</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          {newBrand === null ? (
            <Field label="Marca" error={errors.brandId}>
              {(p) => (
                <Select
                  {...p}
                  value={form.brandId}
                  onChange={(e) => (e.target.value === '__new' ? setNewBrand('') : set('brandId', e.target.value))}
                >
                  <option value="">Sin marca</option>
                  {(brands.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                  <option value="__new">+ Agregar marca…</option>
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Marca nueva">
              {(p) => (
                <div className="flex gap-2">
                  <Input {...p} autoFocus value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
                  <Button size="sm" className="h-10" loading={addBrand.isPending} disabled={!newBrand.trim()} onClick={() => addBrand.mutate(newBrand.trim())}>
                    Agregar
                  </Button>
                  <Button size="sm" variant="ghost" className="h-10" onClick={() => setNewBrand(null)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </Field>
          )}
        </div>
        {!form.hasVariants && (
          <Field label="Código interno (SKU)" error={errors['variants.0.sku']} hint="Opcional. Se puede buscar como un código de barras.">
            {(p) => <Input {...p} value={single.sku} onChange={(e) => setSingle({ sku: e.target.value })} />}
          </Field>
        )}
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Precio</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {!form.hasVariants && (
            <Field label="Precio de venta (con IVA)" error={errors['variants.0.price']} hint={!editPrice ? 'Tu rol no puede cambiar precios.' : undefined}>
              {(p) => <Input {...p} inputMode="decimal" value={single.price} onChange={(e) => setSingle({ price: e.target.value })} disabled={!editPrice} />}
            </Field>
          )}
          {!form.hasVariants && seeCost && (
            <Field label="Costo" error={errors['variants.0.cost']} hint={!editCost ? 'Tu rol no puede cambiar costos.' : 'Opcional.'}>
              {(p) => <Input {...p} inputMode="decimal" value={single.cost} onChange={(e) => setSingle({ cost: e.target.value })} disabled={!editCost} />}
            </Field>
          )}
          <Field label="IVA" error={errors.vatRate}>
            {(p) => (
              <Select {...p} value={form.vatRate} onChange={(e) => set('vatRate', e.target.value as VatRate)}>
                {VAT_RATES.map((r) => (
                  <option key={r} value={r}>
                    {VAT_RATE_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {form.hasVariants && <p className="mt-2 text-xs text-slate-600">El precio y el costo se cargan en cada variante.</p>}
        {!form.hasVariants && seeCost && (
          <div className="mt-2">
            <MarginHint cost={single.cost} price={single.price} />
          </div>
        )}
      </fieldset>

      {variantsAllowed && (
        <fieldset className="min-w-0 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">Variantes</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-slate-300" checked={form.hasVariants} onChange={(e) => toggleVariants(e.target.checked)} />
            Este producto tiene talles, colores u otras variantes
          </label>
          {form.hasVariants && (
            <div className="mt-4">
              <VariantsEditor
                state={form.variants}
                onChange={(variants) => set('variants', variants)}
                errors={errors}
                seeCost={seeCost}
                editCost={editCost}
                editPrice={editPrice}
                initialStock={form.kind === 'good' && form.trackStock && can('stock.adjust')}
                unitName={unit}
                saleMode={form.saleMode}
              />
            </div>
          )}
        </fieldset>
      )}

      {!form.hasVariants && (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">Códigos de barras</legend>
          <p className="mb-3 text-xs text-slate-600">Podés cargar varios, o ninguno. Para el código del pack o la caja, indicá cuántas unidades trae.</p>
          <div className="space-y-2">
            {single.barcodes.map((b, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    aria-label={`Código ${i + 1}`}
                    placeholder="Escaneá o escribí el código"
                    value={b.code}
                    aria-invalid={errors[`variants.0.barcodes.${i}.code`] ? true : undefined}
                    onChange={(e) => setSingle({ barcodes: single.barcodes.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) })}
                    // El lector termina con Enter: no tiene que enviar el formulario.
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      void suggestFrom(b.code);
                    }}
                    onBlur={() => void suggestFrom(b.code)}
                  />
                  {errors[`variants.0.barcodes.${i}.code`] && <p className="mt-1 text-sm text-red-600">{errors[`variants.0.barcodes.${i}.code`]}</p>}
                </div>
                <div className="w-32">
                  <Input
                    aria-label={`Unidades del código ${i + 1}`}
                    inputMode="decimal"
                    value={b.quantityFactor}
                    aria-invalid={errors[`variants.0.barcodes.${i}.quantityFactor`] ? true : undefined}
                    onChange={(e) => setSingle({ barcodes: single.barcodes.map((x, j) => (j === i ? { ...x, quantityFactor: e.target.value } : x)) })}
                  />
                  {errors[`variants.0.barcodes.${i}.quantityFactor`] && <p className="mt-1 text-sm text-red-600">{errors[`variants.0.barcodes.${i}.quantityFactor`]}</p>}
                </div>
                <Button variant="ghost" className="h-10" aria-label={`Quitar código ${i + 1}`} onClick={() => setSingle({ barcodes: single.barcodes.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          {single.barcodes.length < 20 && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSingle({ barcodes: [...single.barcodes, { code: '', quantityFactor: '1' }] })}>
              <Plus className="size-4" aria-hidden /> Agregar código
            </Button>
          )}
        </fieldset>
      )}

      {form.kind === 'good' && (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">Stock</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Se vende" error={errors.saleMode}>
              {(p) => (
                <Select {...p} value={form.saleMode} onChange={(e) => set('saleMode', e.target.value as SaleMode)}>
                  {SALE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {SALE_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {form.trackStock && (
              <Field label="Stock mínimo" error={errors.minStock} hint={`En ${unit}${form.hasVariants ? ', para cada variante' : ''}. Avisa cuando el stock llega a este valor.`}>
                {(p) => <Input {...p} inputMode="decimal" value={form.minStock} onChange={(e) => set('minStock', e.target.value)} />}
              </Field>
            )}
            {!form.hasVariants && single.id === null && form.trackStock && can('stock.adjust') && (
              <Field label="Stock inicial" error={errors['variants.0.initialStock']} hint="Opcional. Queda registrado como un ajuste.">
                {(p) => <Input {...p} inputMode="decimal" value={single.initialStock} onChange={(e) => setSingle({ initialStock: e.target.value })} />}
              </Field>
            )}
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4 rounded border-slate-300" checked={form.trackStock} onChange={(e) => set('trackStock', e.target.checked)} />
              Controlar stock de este producto
            </label>
            {form.trackStock && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  checked={form.blockNegativeStock}
                  onChange={(e) => set('blockNegativeStock', e.target.checked)}
                />
                No permitir que el stock quede negativo, aunque el comercio lo permita
              </label>
            )}
          </div>
        </fieldset>
      )}

      <Field label="Descripción" error={errors.description} hint="Opcional.">
        {(p) => <Input {...p} value={form.description} onChange={(e) => set('description', e.target.value)} />}
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={save.isPending}>
          {editing ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}
