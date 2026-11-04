import { MAX_PRODUCT_OPTIONS, MAX_PRODUCT_VARIANTS, type ProductDto, variantLabel } from '@gc/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { formatQty, toInputDecimal } from '@/lib/format';

/** Una fila del formulario: una variante existente (id) o nueva (id null). */
export interface VariantRow {
  key: string;
  id: string | null;
  options: string[];
  sku: string;
  price: string;
  cashPrice: string;
  cost: string;
  barcodes: Array<{ code: string; quantityFactor: string }>;
  initialStock: string;
  /** Stock actual, solo para mostrar. */
  stock: string | null;
}

let keys = 0;
const nextKey = () => `v${++keys}`;

export function emptyRow(options: string[] = [], price = '', cost = ''): VariantRow {
  return { key: nextKey(), id: null, options, sku: '', price, cashPrice: '', cost, barcodes: [], initialStock: '', stock: null };
}

export function rowsFrom(p: ProductDto): VariantRow[] {
  return p.variants.map((v) => ({
    key: nextKey(),
    id: v.id,
    options: v.options,
    sku: v.sku ?? '',
    price: toInputDecimal(v.price),
    cashPrice: toInputDecimal(v.cashPrice),
    cost: toInputDecimal(v.cost),
    barcodes: v.barcodes.map((b) => ({ code: b.code, quantityFactor: toInputDecimal(b.quantityFactor) })),
    initialStock: '',
    stock: v.stock,
  }));
}

/** «S, M, L» → ['S', 'M', 'L'], sin vacíos ni repetidos. */
export function splitValues(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '' && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}

/** Valores de cada propiedad en el orden en que aparecen en las variantes. */
export function valuesFrom(optionNames: string[], rows: VariantRow[]): string[] {
  return optionNames.map((_, i) => splitValues(rows.map((r) => r.options[i] ?? '').join(',')).join(', '));
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i]!.toLowerCase());

/**
 * Todas las combinaciones de los valores. Conserva las filas que ya existían con la misma
 * combinación; si se agregó una propiedad, la variante vieja pasa a la primera combinación que
 * la contiene (así no pierde su stock ni su historial).
 */
export function combine(values: string[][], current: VariantRow[], price: string, cost: string): VariantRow[] {
  const combos = values.reduce<string[][]>((acc, list) => acc.flatMap((prefix) => list.map((v) => [...prefix, v])), [[]]);
  const unused = [...current];
  const take = (match: (r: VariantRow) => boolean) => {
    const i = unused.findIndex(match);
    return i === -1 ? undefined : unused.splice(i, 1)[0];
  };
  const result = combos.map((options) => {
    const exact = take((r) => same(r.options, options));
    return exact ? { ...exact, options } : undefined;
  });
  return combos.map((options, i) => {
    if (result[i]) return result[i]!;
    const prefix = take((r) => r.id !== null && r.options.length < options.length && same(r.options, options.slice(0, r.options.length)));
    return prefix ? { ...prefix, options } : emptyRow(options, price, cost);
  });
}

export interface VariantsState {
  optionNames: string[];
  /** Texto de valores por propiedad: «S, M, L». */
  optionValues: string[];
  rows: VariantRow[];
}

/**
 * Propiedades (Talle, Color…) con sus valores, y la tabla de variantes con precio, costo, código
 * y stock inicial de cada una. Las variantes sin código de barras se venden buscándolas por nombre.
 */
export function VariantsEditor({
  state,
  onChange,
  errors,
  seeCost,
  editCost,
  editPrice,
  initialStock,
  unitName,
  saleMode,
}: {
  state: VariantsState;
  onChange: (next: VariantsState) => void;
  errors: Record<string, string>;
  seeCost: boolean;
  editCost: boolean;
  /** false si el rol no puede cambiar precios: solo puede cargarlos en variantes nuevas. */
  editPrice: boolean;
  /** Se puede cargar stock inicial en las variantes nuevas. */
  initialStock: boolean;
  unitName: string;
  saleMode: string;
}) {
  const [basePrice, setBasePrice] = useState('');
  const [baseCost, setBaseCost] = useState('');
  const { optionNames, optionValues, rows } = state;
  const parsed = optionValues.map(splitValues);
  const count = parsed.reduce((n, list) => n * Math.max(list.length, 0), optionNames.length > 0 ? 1 : 0);
  const ready = optionNames.length > 0 && optionNames.every((n) => n.trim() !== '') && parsed.every((l) => l.length > 0);
  const setRow = (key: string, patch: Partial<VariantRow>) => onChange({ ...state, rows: rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  function generate() {
    onChange({ ...state, rows: combine(parsed, rows, basePrice, baseCost) });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {optionNames.map((name, i) => (
          <div key={i} className="grid items-start gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <Field label={i === 0 ? 'Propiedad' : ''} error={errors[`optionNames.${i}`]}>
              {(p) => (
                <Input
                  {...p}
                  aria-label={`Nombre de la propiedad ${i + 1}`}
                  placeholder={['Talle', 'Color', 'Material'][i]}
                  value={name}
                  onChange={(e) => onChange({ ...state, optionNames: optionNames.map((n, j) => (j === i ? e.target.value : n)) })}
                />
              )}
            </Field>
            <Field label={i === 0 ? 'Valores, separados por coma' : ''}>
              {(p) => (
                <Input
                  {...p}
                  aria-label={`Valores de ${name || `la propiedad ${i + 1}`}`}
                  placeholder={['S, M, L, XL', 'Negro, Blanco, Rojo', 'Algodón, Lino'][i]}
                  value={optionValues[i] ?? ''}
                  onChange={(e) => onChange({ ...state, optionValues: optionValues.map((v, j) => (j === i ? e.target.value : v)) })}
                />
              )}
            </Field>
            <Button
              variant="ghost"
              className={`h-10 ${i === 0 ? 'sm:mt-7' : ''}`}
              aria-label={`Quitar la propiedad ${name || i + 1}`}
              onClick={() =>
                onChange({
                  optionNames: optionNames.filter((_, j) => j !== i),
                  optionValues: optionValues.filter((_, j) => j !== i),
                  rows: rows.map((r) => ({ ...r, options: r.options.filter((_, j) => j !== i) })),
                })
              }
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        {errors.optionNames && <p className="text-sm text-red-600">{errors.optionNames}</p>}
        {optionNames.length < MAX_PRODUCT_OPTIONS && (
          <Button size="sm" variant="secondary" onClick={() => onChange({ ...state, optionNames: [...optionNames, ''], optionValues: [...optionValues, ''] })}>
            <Plus className="size-4" aria-hidden /> Agregar propiedad
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
        <Field label="Precio para las nuevas">
          {(p) => <Input {...p} className="w-36" inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />}
        </Field>
        {seeCost && editCost && (
          <Field label="Costo para las nuevas">
            {(p) => <Input {...p} className="w-36" inputMode="decimal" value={baseCost} onChange={(e) => setBaseCost(e.target.value)} />}
          </Field>
        )}
        <Button className="h-10" variant="secondary" disabled={!ready || count > MAX_PRODUCT_VARIANTS} onClick={generate}>
          {rows.length === 0 ? `Armar ${count || ''} variantes` : 'Actualizar combinaciones'}
        </Button>
        {count > MAX_PRODUCT_VARIANTS && <p className="text-sm text-red-600">Son {count} combinaciones: el máximo es {MAX_PRODUCT_VARIANTS}.</p>}
        {basePrice && rows.some((r) => r.id === null) && (
          <Button className="h-10" variant="ghost" onClick={() => onChange({ ...state, rows: rows.map((r) => (r.id === null ? { ...r, price: basePrice } : r)) })}>
            Usar este precio en las nuevas
          </Button>
        )}
      </div>

      {errors.variants && <Alert>{errors.variants}</Alert>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[54rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2">Variante</th>
                <th className="px-3 py-2">Precio</th>
                <th className="px-3 py-2">Contado</th>
                {seeCost && <th className="px-3 py-2">Costo</th>}
                <th className="px-3 py-2">Código de barras</th>
                <th className="px-3 py-2">Código interno</th>
                <th className="px-3 py-2">{initialStock ? `Stock (${unitName})` : 'Stock'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const e = (field: string) => errors[`variants.${i}.${field}`];
                const label = variantLabel(r.options) ?? '—';
                const extra = r.barcodes.slice(1);
                return (
                  <tr key={r.key} className="align-top">
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap pt-2 font-medium">{label}</div>
                      {r.id === null && <div className="text-xs text-emerald-700">Nueva</div>}
                      {e('options') && <p className="text-xs text-red-600">{e('options')}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Precio de ${label}`}
                        className="w-28"
                        inputMode="decimal"
                        value={r.price}
                        disabled={!editPrice && r.id !== null}
                        aria-invalid={e('price') ? true : undefined}
                        onChange={(ev) => setRow(r.key, { price: ev.target.value })}
                      />
                      {e('price') && <p className="mt-1 text-xs text-red-600">{e('price')}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Precio de contado de ${label}`}
                        className="w-28"
                        inputMode="decimal"
                        placeholder="Igual"
                        value={r.cashPrice}
                        disabled={!editPrice && r.id !== null}
                        aria-invalid={e('cashPrice') ? true : undefined}
                        onChange={(ev) => setRow(r.key, { cashPrice: ev.target.value })}
                      />
                      {e('cashPrice') && <p className="mt-1 text-xs text-red-600">{e('cashPrice')}</p>}
                    </td>
                    {seeCost && (
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`Costo de ${label}`}
                          className="w-28"
                          inputMode="decimal"
                          value={r.cost}
                          disabled={!editCost}
                          aria-invalid={e('cost') ? true : undefined}
                          onChange={(ev) => setRow(r.key, { cost: ev.target.value })}
                        />
                        {e('cost') && <p className="mt-1 text-xs text-red-600">{e('cost')}</p>}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <Input
                        aria-label={`Código de barras de ${label}`}
                        className="w-40"
                        value={r.barcodes[0]?.code ?? ''}
                        aria-invalid={e('barcodes.0.code') ? true : undefined}
                        // El lector termina con Enter: no tiene que enviar el formulario.
                        onKeyDown={(ev) => ev.key === 'Enter' && ev.preventDefault()}
                        onChange={(ev) => setRow(r.key, { barcodes: [{ code: ev.target.value, quantityFactor: r.barcodes[0]?.quantityFactor ?? '1' }, ...extra] })}
                      />
                      {e('barcodes.0.code') && <p className="mt-1 text-xs text-red-600">{e('barcodes.0.code')}</p>}
                      {extra.length > 0 && <p className="mt-1 text-xs text-slate-500">También: {extra.map((b) => b.code).join(', ')}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Código interno de ${label}`} className="w-32" value={r.sku} aria-invalid={e('sku') ? true : undefined} onChange={(ev) => setRow(r.key, { sku: ev.target.value })} />
                      {e('sku') && <p className="mt-1 text-xs text-red-600">{e('sku')}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {r.id === null && initialStock ? (
                        <>
                          <Input
                            aria-label={`Stock inicial de ${label}`}
                            className="w-24"
                            inputMode="decimal"
                            placeholder="0"
                            value={r.initialStock}
                            aria-invalid={e('initialStock') ? true : undefined}
                            onChange={(ev) => setRow(r.key, { initialStock: ev.target.value })}
                          />
                          {e('initialStock') && <p className="mt-1 text-xs text-red-600">{e('initialStock')}</p>}
                        </>
                      ) : (
                        <div className="pt-2 text-slate-600">{r.stock === null ? '—' : formatQty(r.stock, saleMode)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" className="h-10" aria-label={`Quitar ${label}`} onClick={() => onChange({ ...state, rows: rows.filter((x) => x.key !== r.key) })}>
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
      {rows.some((r) => r.id !== null) && (
        <p className="text-xs text-slate-500">
          Quitar una variante la deja de mostrar para vender; su stock tiene que estar en cero. Si la volvés a cargar, recupera su historial.
        </p>
      )}
    </div>
  );
}
