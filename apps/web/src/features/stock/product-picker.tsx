import { type ItemDto, type Paginated, type ProductLookupDto, variantDisplayName } from '@gc/contracts';
import { dec } from '@gc/domain';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type KeyboardEvent, type Ref, useState } from 'react';
import { Input } from '@/components/ui/field';
import { formatQty } from '@/lib/format';
import { ApiRequestError, http } from '@/lib/api';
import { parseSaleTicketCode } from '@/features/sales/exchange-ticket';

/**
 * Buscador de artículos para cargar cantidades: el lector de códigos escribe el código y manda
 * Enter (búsqueda exacta); también se puede escribir parte del nombre y del talle o color
 * («remera m rojo») y elegir la variante de la lista, para lo que no tiene código de barras.
 */
export function ProductPicker({
  onPick,
  label = 'Buscar o escanear un artículo',
  onlyStock = true,
  inputRef,
  autoFocus,
  inputClassName,
  multiplier = false,
  onMissingCode,
  onSaleTicket,
}: {
  onPick: (item: ItemDto, quantityFactor: string) => void;
  label?: string;
  /** Para inventario solo sirven los artículos que controlan stock; en la caja se vende todo. */
  onlyStock?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  inputClassName?: string;
  /** Permite «cantidad * código»: «12*» y escanear carga 12 de una vez. */
  multiplier?: boolean;
  /** Si se pasa, un código que no está cargado ofrece crearlo en el momento. */
  onMissingCode?: (code: string) => void;
  /** Si se pasa, escanear un ticket de cambio («V123») abre esa venta. */
  onSaleTicket?: (saleNumber: number) => void;
}) {
  const [term, setTerm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [times, setTimes] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const q = term.trim().replace(multiplier ? /^\d+(?:[.,]\d{1,3})?\s*[*×]\s*/ : /^$/, '');
  const results = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => http.get<Paginated<ItemDto>>(`/products/items?pageSize=12&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const options = (results.data?.items ?? []).filter((p) => p.status === 'active' && (!onlyStock || p.trackStock));

  /** Aplica la cantidad pendiente («12*») y la olvida. */
  function deliver(p: ItemDto, factor: string, by = times) {
    onPick(p, by ? dec(factor).times(by).toFixed(3) : factor);
    setTimes(null);
  }
  function pick(p: ItemDto, factor = '1.000') {
    deliver(p, factor);
    setTerm('');
    setMessage(null);
  }

  async function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    let code = e.currentTarget.value.trim();
    if (e.key !== 'Enter' || !code) return;
    e.preventDefault();
    let by = times;
    const m = multiplier ? /^(\d+(?:[.,]\d{1,3})?)\s*[*×]\s*(.*)$/.exec(code) : null;
    if (m) {
      const qty = m[1]!.replace(',', '.');
      if (!dec(qty).gt(0)) return setMessage('La cantidad tiene que ser mayor a cero');
      if (!m[2]) {
        setTimes(qty);
        setTerm('');
        return setMessage(null);
      }
      by = qty;
      code = m[2];
    }
    // Liberar el lector al enviar el pedido: una respuesta anterior no debe borrar el siguiente escaneo.
    setTerm('');
    setMessage(null);
    setMissing(null);
    try {
      const found = await http.get<ProductLookupDto>(`/products/lookup?code=${encodeURIComponent(code)}`);
      const name = variantDisplayName(found.item.name, found.item.variantLabel);
      if (onlyStock && !found.item.trackStock) return setMessage(`${name} no controla stock`);
      if (found.item.status !== 'active') return setMessage(`${name} está desactivado`);
      deliver(found.item, found.quantityFactor, by);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        const saleNumber = parseSaleTicketCode(code);
        if (saleNumber !== null && onSaleTicket) return onSaleTicket(saleNumber);
        if (options.length === 1) return deliver(options[0]!, '1.000', by);
        setMissing(code);
        return setMessage(`No hay ningún artículo con el código ${code}`);
      }
      setMessage('No se pudo buscar el código');
    }
  }

  return (
    <div className="relative">
      {times && (
        <span className="absolute right-2 top-1/2 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded-full bg-brand-600 py-1 pl-3 pr-1 text-sm font-bold text-white">
          × {times.replace('.', ',')}
          <button type="button" aria-label="Quitar la cantidad" className="rounded-full p-1 hover:bg-white/20" onClick={() => setTimes(null)}>
            <X className="size-4" />
          </button>
        </span>
      )}
      <Input ref={inputRef} autoFocus={autoFocus} className={inputClassName} type="search" autoComplete="off" aria-label={label} placeholder={label} value={term} onChange={(e) => (setTerm(e.target.value), setMessage(null), setMissing(null))} onKeyDown={(e) => void onKeyDown(e)} />
      {message && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-red-600">
          {message}
          {missing && onMissingCode && (
            <button type="button" className="font-semibold text-brand-700 underline underline-offset-2" onClick={() => (onMissingCode(missing), setMessage(null), setMissing(null))}>
              Crear producto con este código
            </button>
          )}
        </p>
      )}
      {q.length >= 2 && options.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox">
          {options.map((p) => (
            <li key={p.variantId}>
              <button type="button" className="flex w-full items-baseline justify-between gap-3 px-3 py-3 text-left text-sm hover:bg-brand-50" onClick={() => pick(p)}>
                <span>
                  <span className="font-medium">{p.name}</span>
                  {p.variantLabel && <span className="ml-1.5 font-semibold text-brand-700">{p.variantLabel}</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {p.sku ?? p.barcodes[0]?.code}
                  {p.stock !== null && (
                    <span className={dec(p.stock).lte(0) ? 'ml-2 font-semibold text-red-700' : 'ml-2'}>
                      {dec(p.stock).lte(0) ? 'sin stock' : `stock ${formatQty(p.stock, p.saleMode)}`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
