import { formatArs } from '@gc/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { type Invoice } from './invoice';
import { invoiceNumber } from './invoice-dialog';

/**
 * Nota de crédito de una devolución o de la anulación de una venta facturada (ADR 0017): se
 * asocia a la factura y va por lo devuelto. Si ARCA no confirma, se vuelve a tocar y se consulta.
 */
export function CreditNoteDialog({ invoice, saleReturnId, amount, existing, onClose }: { invoice: Invoice; saleReturnId: string | null; amount: string; existing?: Invoice; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const production = invoice.environment === 'produccion';
  const issue = useMutation({
    mutationFn: () => http.post<Invoice>(`/sales/${invoice.saleId}/credit-notes`, { environment: invoice.environment, saleReturnId, confirmProduction: production ? confirm : null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fiscal-invoices'] }),
  });
  const result = issue.data ?? existing;
  function submit(e: FormEvent) {
    e.preventDefault();
    issue.mutate();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !issue.isPending && onClose()} title="Nota de crédito" description={`Corrige la ${invoiceNumber(invoice)} por ${formatArs(amount)}${saleReturnId ? ' devueltos' : ' de la venta anulada'}.`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {issue.error && <Alert>{errorMessage(issue.error)}</Alert>}
        {result?.status === 'authorized' ? (
          <Alert kind="success">
            {invoiceNumber(result)} autorizada · CAE {result.cae}
          </Alert>
        ) : (
          <>
            {result && <Alert kind="info">{result.message || 'ARCA todavía no confirmó la nota de crédito. Volvé a tocar Emitir para consultarla: no se emite otra.'}</Alert>}
            {!production && <p className="text-sm text-slate-600">Es el ambiente de prueba (homologación): el comprobante no tiene validez fiscal.</p>}
            {production && (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                <span>Confirmo que quiero emitir una nota de crédito real en ARCA por {formatArs(amount)}.</span>
              </label>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={issue.isPending}>
            {result?.status === 'authorized' ? 'Cerrar' : 'Volver'}
          </Button>
          {result?.status !== 'authorized' && (
            <Button type="submit" loading={issue.isPending} disabled={production && !confirm}>
              Emitir nota de crédito
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
