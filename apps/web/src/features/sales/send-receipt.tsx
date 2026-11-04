import { type SaleDto, sendSaleEmailSchema, type TenantDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, MessageCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { arcaQrUrl, type Invoice, TYPES } from '@/features/fiscal/invoice';
import { saleInvoicesQuery } from '@/features/fiscal/invoice-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime, formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';

const invoiceLabel = (i: Invoice) => `${TYPES[i.voucherType]} ${String(i.pointOfSale).padStart(5, '0')}-${String(i.number).padStart(8, '0')}`;

/** Texto del comprobante para mandar por WhatsApp (con *negrita* de WhatsApp). */
export function whatsappText(sale: SaleDto, tenant: TenantDto, invoice?: Invoice): string {
  const head = `*${tenant.tradeName}*`;
  if (invoice) {
    return [head, `${invoiceLabel(invoice)} · Total ${formatArs(String(invoice.payload.request.ImpTotal))}`, `CAE ${invoice.cae}`, `Consultala en ARCA: ${arcaQrUrl(invoice)}`, '', '¡Gracias por tu compra!'].join('\n');
  }
  const lines = sale.lines.map((l) => `${formatQty(l.quantity, l.saleMode)} x ${l.description} · ${formatArs(l.total)}`);
  return [
    head,
    `Venta N° ${String(sale.number).padStart(8, '0')} · ${formatDateTime(sale.confirmedAt)}`,
    '',
    ...(sale.giftCard ? [`Gift card · ${formatArs(sale.giftCard.amount)}`] : []),
    ...lines,
    '',
    `*Total ${formatArs(sale.total)}*`,
    'Comprobante no válido como factura.',
    '¡Gracias por tu compra!',
  ].join('\n');
}

/** Número para wa.me: 549 + característica + número, sin 0 ni 15. Vacío: WhatsApp pregunta a quién. */
export function whatsappNumber(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('54')) d = d.slice(2);
  if (d.startsWith('9')) d = d.slice(1);
  if (d.startsWith('0')) d = d.slice(1);
  // «11 15 2345 6789» → sin el 15 que va después de la característica (de 2 a 4 dígitos).
  if (d.length === 12) d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return `549${d}`;
}

/**
 * Mandar el comprobante al cliente: por email (lo envía el sistema) o por WhatsApp (abre WhatsApp
 * con el texto listo, sin servicios pagos). Si la venta está facturada, se elige ticket o factura.
 */
export function SendReceipt({ sale, tenant }: { sale: SaleDto; tenant: TenantDto }) {
  const can = useCan();
  const canInvoice = can('fiscal.issue', 'fiscal.manage');
  const invoices = useQuery({ ...saleInvoicesQuery(sale.id), enabled: canInvoice });
  const authorized = (invoices.data ?? []).filter((i) => i.kind === 'invoice' && i.status === 'authorized');
  const invoice = authorized.find((i) => i.environment === 'produccion') ?? authorized[0];
  const [what, setWhat] = useState<'ticket' | 'invoice' | null>(null);
  const sendInvoice = (what ?? (invoice ? 'invoice' : 'ticket')) === 'invoice' && !!invoice;
  const customer = sale.customer;
  const [email, setEmail] = useState(customer?.email ?? '');
  const [save, setSave] = useState(false);
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const canSave = !!customer && can('customers.manage') && email.trim().toLowerCase() !== (customer.email ?? '');

  const send = useMutation({
    mutationFn: (body: unknown) => http.post<{ sent: boolean; email: string }>(`/sales/${sale.id}/email`, body),
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = sendSaleEmailSchema.safeParse({ email, invoiceId: sendInvoice ? invoice!.id : null, saveToCustomer: canSave && save });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Email inválido');
    setError(null);
    send.mutate(parsed.data);
  }

  function openWhatsapp() {
    const text = encodeURIComponent(whatsappText(sale, tenant, sendInvoice ? invoice : undefined));
    window.open(`https://wa.me/${whatsappNumber(phone)}?text=${text}`, '_blank', 'noopener');
  }

  return (
    <div className="space-y-3">
      {invoice && (
        <div role="group" aria-label="Qué mandar" className="flex gap-2">
          <Button size="sm" variant={sendInvoice ? 'primary' : 'secondary'} aria-pressed={sendInvoice} onClick={() => setWhat('invoice')}>
            {invoiceLabel(invoice)}
          </Button>
          <Button size="sm" variant={!sendInvoice ? 'primary' : 'secondary'} aria-pressed={!sendInvoice} onClick={() => setWhat('ticket')}>
            Ticket
          </Button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-2" noValidate>
        {error && <Alert>{error}</Alert>}
        {send.isSuccess && !error && <Alert kind="success">Listo: se mandó a {send.data.email}.</Alert>}
        <div className="flex gap-2">
          <Input aria-label="Email del cliente" type="email" inputMode="email" autoComplete="off" placeholder="Email del cliente" className="h-11" value={email} onChange={(e) => (setEmail(e.target.value), send.reset())} />
          <Button type="submit" variant="secondary" className="h-11 shrink-0" loading={send.isPending}>
            <Mail className="size-4" /> Enviar
          </Button>
        </div>
        {canSave && email.trim() && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="size-4" checked={save} onChange={(e) => setSave(e.target.checked)} /> Guardar este email en la ficha de {customer!.name}
          </label>
        )}
      </form>
      <div className="flex gap-2">
        <Input aria-label="WhatsApp del cliente" type="tel" inputMode="tel" autoComplete="off" placeholder="WhatsApp (opcional), ej.: 3492 567666" className="h-11" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button variant="secondary" className="h-11 shrink-0" onClick={openWhatsapp}>
          <MessageCircle className="size-4" /> WhatsApp
        </Button>
      </div>
      <p className="text-xs text-slate-500">WhatsApp se abre con el comprobante escrito: lo mandás vos desde tu cuenta, sin costo. Sin número, WhatsApp te deja elegir el contacto.</p>
    </div>
  );
}
