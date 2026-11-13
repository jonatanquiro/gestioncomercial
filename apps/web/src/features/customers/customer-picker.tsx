import { type CustomerDto, type CustomerListDto } from '@gc/contracts';
import { useQuery } from '@tanstack/react-query';
import { UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { http } from '@/lib/api';
import { useCan } from '@/lib/session';
import { CustomerForm } from './customer-form';
import { BalanceText, documentLabel } from './customers-page';

/** Cliente de la venta en curso: opcional; hace falta para fiar y sirve para facturarle. */
export function CustomerPicker({ customer, onChange }: { customer: CustomerDto | null; onChange: (customer: CustomerDto | null) => void }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const results = useQuery({
    queryKey: ['customers', 'picker', q.trim()],
    queryFn: () => http.get<CustomerListDto>(`/customers?pageSize=8&q=${encodeURIComponent(q.trim())}`),
    enabled: open && !creating,
  });
  const close = () => (setOpen(false), setCreating(false), setQ(''));

  return (
    <>
      {customer ? (
        <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm">
          <UserRound className="size-4 shrink-0 text-brand-700" aria-hidden />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(true)}>
            <span className="block truncate font-semibold">{customer.name}</span>
            <span className="text-xs">
              <BalanceText balance={customer.balance} />
            </span>
          </button>
          <button type="button" className="rounded-full p-1.5 text-slate-500 hover:text-red-700" aria-label="Quitar el cliente" onClick={() => onChange(null)}>
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <UserRound className="size-4" /> Elegir cliente
        </Button>
      )}
      {open && (
        <Dialog open onOpenChange={(o) => !o && close()} title={creating ? 'Nuevo cliente' : 'Cliente de la venta'} wide={creating}>
          {creating ? (
            <CustomerForm initialName={q} onDone={(saved) => (onChange(saved), close())} />
          ) : (
            <div className="space-y-3">
              <Input autoFocus aria-label="Buscar cliente" placeholder="Nombre, documento o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
              {results.isLoading && <Spinner />}
              {results.data && results.data.items.length === 0 && <EmptyState>No hay clientes con esa búsqueda.</EmptyState>}
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto" aria-label="Clientes">
                {(results.data?.items ?? []).map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-baseline justify-between gap-3 px-2 py-3 text-left text-sm hover:bg-brand-50" onClick={() => (onChange(c), close())}>
                      <span>
                        <span className="font-medium">{c.name}</span>
                        <span className="block text-xs text-slate-500">{documentLabel(c.documentType, c.documentNumber) ?? c.phone ?? ''}</span>
                      </span>
                      <span className="text-xs">
                        <BalanceText balance={c.balance} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {can('customers.manage') && (
                <Button variant="secondary" className="w-full" onClick={() => setCreating(true)}>
                  Nuevo cliente
                </Button>
              )}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
