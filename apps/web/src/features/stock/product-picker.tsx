import type { Paginated, ProductDto, ProductLookupDto } from '@gc/contracts';
import { dec } from '@gc/domain';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type KeyboardEvent, type Ref, useState } from 'react';
import { Input } from '@/components/ui/field';
import { ApiRequestError, http } from '@/lib/api';

/**
 * Buscador de artículos para cargar cantidades: el lector de códigos escribe el código y manda
 * Enter (búsqueda exacta); también se puede escribir parte del nombre y elegir de la lista.
 */
export function ProductPicker({
  onPick,
  label = 'Buscar o escanear un artículo',
  onlyStock = true,
  inputRef,
  autoFocus,
  inputClassName,
  multiplier = false,
}: {
  onPick: (p: ProductDto, quantityFactor: string) => void;
  label?: string;
  /** Para inventario solo sirven los artículos que controlan stock; en la caja se vende todo. */
  onlyStock?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  inputClassName?: string;
  /** Permite «cantidad * código»: «12*» y escanear carga 12 de una vez. */
  multiplier?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [times, setTimes] = useState<string | null>(null);
  const q = term.trim().replace(multiplier ? /^\d+(?:[.,]\d{1,3})?\s*[*×]\s*/ : /^$/, '');
  const results = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => http.get<Paginated<ProductDto>>(`/products?pageSize=8&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const options = (results.data?.items ?? []).filter((p) => p.status === 'active' && (!onlyStock || p.trackStock));

  /** Aplica la cantidad pendiente («12*») y la olvida. */
  function deliver(p: ProductDto, factor: string, by = times) {
    onPick(p, by ? dec(factor).times(by).toFixed(3) : factor);
    setTimes(null);
  }
  function pick(p: ProductDto, factor = '1.000') {
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
    try {
      const found = await http.get<ProductLookupDto>(`/products/lookup?code=${encodeURIComponent(code)}`);
      if (onlyStock && !found.product.trackStock) return setMessage(`${found.product.name} no controla stock`);
      if (found.product.status !== 'active') return setMessage(`${found.product.name} está desactivado`);
      deliver(found.product, found.quantityFactor, by);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        if (options.length === 1) return deliver(options[0]!, '1.000', by);
        return setMessage('No hay ningún artículo con ese código');
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
      <Input ref={inputRef} autoFocus={autoFocus} className={inputClassName} type="search" autoComplete="off" aria-label={label} placeholder={label} value={term} onChange={(e) => (setTerm(e.target.value), setMessage(null))} onKeyDown={(e) => void onKeyDown(e)} />
      {message && <p className="mt-1 text-sm text-red-600">{message}</p>}
      {q.length >= 2 && options.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg" role="listbox">
          {options.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-3 text-left text-sm hover:bg-brand-50" onClick={() => pick(p)}>
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-slate-500">{p.sku ?? p.barcodes[0]?.code ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
