import { type ItemDto, type ProductDto, variantDisplayName } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Printer, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Forbidden } from '@/features/layout/app-layout';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { barcodeModules } from '@/lib/barcode';
import { formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { itemOf } from './item';
import { tenantQuery } from './queries';

type Format = 'roll' | 'a4';
interface Row {
  item: ItemDto;
  copies: string;
}

/** Medidas de cada formato: rollo de etiquetas de 50 × 25 mm o hoja A4 de 3 × 8 (24 por hoja). */
const FORMATS: Record<Format, { label: string; width: number; height: number; page: string }> = {
  roll: { label: 'Rollo de etiquetas 50 × 25 mm', width: 50, height: 25, page: '50mm 25mm' },
  a4: { label: 'Hoja A4 autoadhesiva, 24 por hoja (70 × 37 mm)', width: 70, height: 37.1, page: 'A4' },
};

/**
 * Etiquetas con código de barras (ADR 0014). Lo que no tiene código recibe uno interno, así la
 * ropa o lo fraccionado se vende escaneando en lugar de buscando.
 */
export function LabelsPage() {
  const can = useCan();
  const toast = useToast();
  const { productId } = useSearch({ from: '/app/etiquetas' });
  const tenant = useQuery(tenantQuery);
  const [rows, setRows] = useState<Row[]>([]);
  const [format, setFormat] = useState<Format>('roll');
  const [showPrice, setShowPrice] = useState(true);
  const [printing, setPrinting] = useState(false);
  const loaded = useRef<string | null>(null);

  // Desde Productos → «Imprimir etiquetas»: todas las variantes, una etiqueta por unidad en stock.
  const product = useQuery({ queryKey: ['products', productId], queryFn: () => http.get<ProductDto>(`/products/${productId}`), enabled: !!productId });
  useEffect(() => {
    if (!product.data || loaded.current === product.data.id) return;
    loaded.current = product.data.id;
    setRows(product.data.variants.map((v) => ({ item: itemOf(product.data!, v), copies: copiesFor(v.stock) })));
  }, [product.data]);

  const generate = useMutation({
    mutationFn: () => http.post<{ generated: number; items: ItemDto[] }>('/products/barcodes', { variantIds: rows.map((r) => r.item.variantId) }),
    onSuccess: (res) => {
      setRows((list) => list.map((r) => ({ ...r, item: res.items.find((i) => i.variantId === r.item.variantId) ?? r.item })));
      toast(res.generated === 1 ? 'Se generó 1 código' : `Se generaron ${res.generated} códigos`);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (!can('products.read')) return <Forbidden />;
  const withoutCode = rows.filter((r) => r.item.barcodes.length === 0);
  const labels = rows.flatMap((r) => Array.from({ length: Math.min(500, Math.max(0, Number.parseInt(r.copies, 10) || 0)) }, () => r.item));

  function add(item: ItemDto) {
    setRows((list) => (list.some((r) => r.item.variantId === item.variantId) ? list : [...list, { item, copies: '1' }]));
  }

  return (
    <>
      <PageHeader title="Etiquetas" description="Imprimí etiquetas con código de barras y precio. Lo que no tiene código recibe uno interno para venderlo escaneando." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <ProductPicker onlyStock={false} onPick={add} label="Escaneá o buscá un artículo para etiquetar" />
          {product.error && <div className="mt-3"><Alert>{errorMessage(product.error)}</Alert></div>}
          {rows.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-500">Agregá artículos, o entrá desde Productos → «Imprimir etiquetas» para cargar todas las variantes de uno.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
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
                          <Input aria-label={`Etiquetas de ${name}`} inputMode="numeric" className="h-9 text-right" value={r.copies} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, copies: e.target.value.replace(/\D/g, '') } : x)))} />
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
          )}
        </Card>

        <Card className="h-fit space-y-4 p-5">
          {withoutCode.length > 0 && (
            <Alert kind="info">
              {withoutCode.length === 1 ? '1 artículo no tiene' : `${withoutCode.length} artículos no tienen`} código de barras.
              {can('products.update') ? (
                <Button size="sm" variant="secondary" className="mt-2 w-full" loading={generate.isPending} onClick={() => generate.mutate()}>
                  Generar códigos internos
                </Button>
              ) : (
                ' Pedile a un encargado que les genere uno.'
              )}
            </Alert>
          )}
          <Field label="Formato">
            {(p) => (
              <Select {...p} value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                {(Object.keys(FORMATS) as Format[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMATS[f].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-slate-300" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
            Mostrar el precio
          </label>
          {rows.length > 0 && (
            <Button variant="ghost" className="w-full" onClick={() => setRows(rows.map((r) => ({ ...r, copies: copiesFor(r.item.stock) })))}>
              Una etiqueta por unidad en stock
            </Button>
          )}
          <Button className="h-12 w-full" disabled={labels.length === 0 || withoutCode.length > 0} onClick={() => setPrinting(true)}>
            <Printer className="size-4" aria-hidden /> Imprimir {labels.length === 1 ? '1 etiqueta' : `${labels.length} etiquetas`}
          </Button>
          {withoutCode.length > 0 && labels.length > 0 && <p className="text-xs text-slate-500">Primero generá los códigos que faltan.</p>}
          {labels.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Vista previa</p>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
                <Label item={labels[0]!} format={format} showPrice={showPrice} store={tenant.data?.tradeName} />
              </div>
            </div>
          )}
        </Card>
      </div>
      {printing && <PrintLabels labels={labels} format={format} showPrice={showPrice} store={tenant.data?.tradeName} onDone={() => setPrinting(false)} />}
    </>
  );
}

const copiesFor = (stock: string | null) => (stock !== null && dec(stock).gt(0) ? String(Math.ceil(Number(stock))) : '1');

function Label({ item, format, showPrice, store }: { item: ItemDto; format: Format; showPrice: boolean; store?: string }) {
  const f = FORMATS[format];
  const code = item.barcodes[0]?.code ?? '';
  return (
    <div className="label flex flex-col overflow-hidden bg-white px-[2mm] py-[1.5mm] text-black" style={{ width: `${f.width}mm`, height: `${f.height}mm` }}>
      {store && format === 'a4' && <div className="truncate text-[6pt] uppercase tracking-wider">{store}</div>}
      <div className="line-clamp-1 text-[7.5pt] font-semibold leading-tight">{item.name}</div>
      <div className="flex items-baseline justify-between gap-1 leading-tight">
        <span className="truncate text-[8pt] font-bold">{item.variantLabel ?? ''}</span>
        {showPrice && <span className="shrink-0 text-[10pt] font-bold">{formatArs(item.price)}</span>}
      </div>
      <BarcodeSvg code={code} className="mt-auto min-h-0 w-full flex-1" />
      <div className="text-center font-mono text-[6.5pt] leading-none tracking-[0.15em]">{code}</div>
    </div>
  );
}

/** Código de barras en SVG, con margen blanco a los costados para que el lector lo tome. */
function BarcodeSvg({ code, className }: { code: string; className?: string }) {
  const encoded = barcodeModules(code);
  if (!encoded) return <div className={className} />;
  const quiet = 10;
  const bars: Array<[number, number]> = [];
  for (let i = 0; i < encoded.modules.length; i++) {
    if (encoded.modules[i] !== '1') continue;
    const start = i;
    while (encoded.modules[i + 1] === '1') i++;
    bars.push([start, i - start + 1]);
  }
  return (
    <svg className={className} viewBox={`0 0 ${encoded.modules.length + quiet * 2} 40`} preserveAspectRatio="none" role="img" aria-label={`Código ${code}`} shapeRendering="crispEdges">
      {bars.map(([x, w]) => (
        <rect key={x} x={x + quiet} y={0} width={w} height={40} fill="#000" />
      ))}
    </svg>
  );
}

/** Imprime las etiquetas con la medida de página del formato; al terminar avisa. */
function PrintLabels({ labels, format, showPrice, store, onDone }: { labels: ItemDto[]; format: Format; showPrice: boolean; store?: string; onDone: () => void }) {
  const f = FORMATS[format];
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener('afterprint', after, { once: true });
    const t = window.setTimeout(() => window.print(), 100);
    return () => (window.clearTimeout(t), window.removeEventListener('afterprint', after));
  }, [onDone]);
  const page = (items: ItemDto[], key: number) => items.map((item, i) => <Label key={`${key}-${i}`} item={item} format={format} showPrice={showPrice} store={store} />);
  // En A4, de a 24 por hoja (3 columnas × 8 filas) con salto de página; en rollo, una por página.
  const sheets = format === 'a4' ? Array.from({ length: Math.ceil(labels.length / 24) }, (_, i) => labels.slice(i * 24, i * 24 + 24)) : [];
  return createPortal(
    <div id="print-root" className={`labels labels-${format}`}>
      <style>{`@media print { @page { size: ${f.page}; margin: 0; } #print-root.labels { width: auto; } }`}</style>
      {format === 'a4'
        ? sheets.map((sheet, i) => (
            <div key={i} className="labels-sheet grid grid-cols-3 content-start" style={{ width: '210mm', height: '297mm' }}>
              {page(sheet, i)}
            </div>
          ))
        : page(labels, 0)}
    </div>,
    document.body,
  );
}
