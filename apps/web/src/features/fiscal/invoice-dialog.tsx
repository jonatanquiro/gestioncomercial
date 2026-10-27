import type { SaleDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Spinner } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { type Environment, type Invoice, InvoicePrint, TYPES } from './invoice';

type FiscalStatus = { environment: Environment; pointOfSale: number; ready: boolean };
type Buyer = 'final' | 'dni' | 'cuit';
const ENVIRONMENT_LABELS: Record<Environment, string> = { homologacion: 'Homologación (prueba, sin validez fiscal)', produccion: 'Producción (factura real)' };

export const fiscalStatusQuery = { queryKey: ['fiscal-status'], queryFn: () => http.get<FiscalStatus[]>('/fiscal/status'), staleTime: 60_000 };
export const saleInvoicesQuery = (saleId: string) => ({ queryKey: ['fiscal-invoices', 'sale', saleId], queryFn: () => http.get<Invoice[]>(`/fiscal/invoices?saleId=${saleId}`) });
export const invoiceNumber = (i: Invoice) => `${TYPES[i.voucherType]} ${String(i.pointOfSale).padStart(5, '0')}-${String(i.number).padStart(8, '0')}`;

/**
 * Factura de una venta sin salir de ella. Por defecto, consumidor final con el comprobante que
 * corresponde a la condición del comercio; los datos del cliente se piden solo si hacen falta.
 */
export function InvoiceDialog({ sale, taxCondition, canConfigure, onClose }: { sale: Pick<SaleDto, 'id' | 'number' | 'total'>; taxCondition?: string; canConfigure: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const status = useQuery(fiscalStatusQuery);
  const existing = useQuery(saleInvoicesQuery(sale.id));
  const ready = (status.data ?? []).filter((s) => s.ready);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const env = environment ?? (ready.find((s) => s.environment === 'produccion') ?? ready[0])?.environment ?? null;
  const inscripto = taxCondition === 'responsable_inscripto';
  const [type, setType] = useState(inscripto ? '6' : '11');
  const [buyer, setBuyer] = useState<Buyer>('final');
  const [docNumber, setDocNumber] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [condition, setCondition] = useState('5');
  const [confirm, setConfirm] = useState(false);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const issue = useMutation({
    mutationFn: () =>
      http.post<Invoice>(`/sales/${sale.id}/invoice`, {
        environment: env,
        voucherType: Number(type),
        documentType: buyer === 'final' ? 99 : buyer === 'dni' ? 96 : 80,
        documentNumber: buyer === 'final' ? '0' : docNumber.replace(/\D/g, ''),
        buyerName: buyer === 'final' ? 'Consumidor final' : name.trim(),
        buyerAddress: address.trim() || null,
        vatCondition: Number(buyer === 'final' ? '5' : condition),
        confirmProduction: env === 'produccion' ? confirm : null,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['fiscal-invoices'] }),
  });
  const forEnv = existing.data?.filter((i) => i.environment === env) ?? [];
  const result = issue.data ?? forEnv.find((i) => i.status === 'authorized') ?? forEnv.find((i) => i.status === 'pending');
  const chooseBuyer = (b: Buyer) => {
    setBuyer(b);
    setCondition(b === 'cuit' ? '1' : '5');
    if (b !== 'cuit' && type === '1') setType('6');
  };
  const missingBuyer = buyer !== 'final' && (!docNumber.trim() || !name.trim());

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !issue.isPending && onClose()} title={`Facturar venta N° ${sale.number}`} description={`Total ${formatArs(sale.total)}`}>
        {(status.isLoading || existing.isLoading) && <Spinner />}
        {status.error && <Alert>{errorMessage(status.error)}</Alert>}
        {status.data && !env && (
          <div className="space-y-3">
            <Alert kind="info">La facturación electrónica todavía no está configurada en este comercio.</Alert>
            {canConfigure ? (
              <Link to="/app/facturacion" className="text-sm font-semibold text-brand-700 hover:underline">
                Configurar facturación ARCA
              </Link>
            ) : (
              <p className="text-sm text-slate-600">Pedile al encargado que cargue el certificado de ARCA.</p>
            )}
          </div>
        )}
        {env && existing.data && result?.status === 'authorized' && (
          <div className="space-y-4">
            <Alert kind="success">
              {invoiceNumber(result)} autorizada · CAE {result.cae}
              {result.environment === 'homologacion' && ' · prueba sin validez fiscal'}
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" className="h-12" onClick={onClose}>
                Cerrar
              </Button>
              <Button className="h-12" onClick={() => setPrinting(result)}>
                <Printer className="size-4" /> Imprimir factura
              </Button>
            </div>
          </div>
        )}
        {env && existing.data && result?.status !== 'authorized' && (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              issue.mutate();
            }}
          >
            {issue.error && <Alert>{errorMessage(issue.error)}</Alert>}
            {result && <Alert kind="info">{result.message || 'ARCA todavía no confirmó la factura. Volvé a tocar Facturar para consultarla: no se emite otra.'}</Alert>}
            {ready.length > 1 ? (
              <Field label="Ambiente">
                {(p) => (
                  <Select {...p} value={env} onChange={(e) => setEnvironment(e.target.value as Environment)}>
                    {ready.map((s) => (
                      <option key={s.environment} value={s.environment}>
                        {ENVIRONMENT_LABELS[s.environment]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              env === 'homologacion' && <p className="text-sm font-medium text-amber-800">Homologación: es una prueba y no tiene validez fiscal.</p>
            )}
            <div role="group" aria-label="Cliente" className="grid grid-cols-3 gap-2">
              {(
                [
                  ['final', 'Consumidor final'],
                  ['dni', 'Con DNI'],
                  ['cuit', 'Con CUIT'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={buyer === value}
                  className={`h-12 rounded-xl border px-2 text-sm font-semibold ${buyer === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white hover:border-brand-300'}`}
                  onClick={() => chooseBuyer(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {inscripto ? (
              <Field label="Comprobante">
                {(p) => (
                  <Select {...p} value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="6">Factura B</option>
                    <option value="1" disabled={buyer !== 'cuit'}>
                      Factura A (cliente con CUIT)
                    </option>
                  </Select>
                )}
              </Field>
            ) : (
              <p className="text-sm text-slate-600">Se emite Factura C.</p>
            )}
            {buyer !== 'final' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={buyer === 'dni' ? 'DNI (sin puntos)' : 'CUIT'}>{(p) => <Input {...p} inputMode="numeric" autoFocus value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />}</Field>
                <Field label="Nombre o razón social">{(p) => <Input {...p} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
                <Field label="Domicilio (opcional)">{(p) => <Input {...p} maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />}</Field>
                <Field label="Condición frente al IVA">
                  {(p) => (
                    <Select {...p} value={condition} onChange={(e) => setCondition(e.target.value)}>
                      <option value="5">Consumidor final</option>
                      <option value="1">Responsable inscripto</option>
                      <option value="6">Monotributista</option>
                      <option value="4">Exento</option>
                    </Select>
                  )}
                </Field>
              </div>
            )}
            {env === 'produccion' && (
              <label className="flex items-start gap-3 text-sm font-semibold text-red-800">
                <input type="checkbox" className="mt-1 size-5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                Confirmo que quiero emitir una factura real con estos datos.
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" className="h-12" onClick={onClose} disabled={issue.isPending}>
                Volver
              </Button>
              <Button type="submit" className="h-12 min-w-40" loading={issue.isPending} disabled={missingBuyer || (env === 'produccion' && !confirm)}>
                Facturar
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      {printing && <InvoicePrint invoice={printing} onClose={() => setPrinting(null)} />}
    </>
  );
}
