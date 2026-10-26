import { type SaleDto, TAX_CONDITION_LABELS, type TenantDto } from '@gc/contracts';
import { dec, formatArs, roundMoney } from '@gc/domain';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatCuit, formatDateTime, formatQty } from '@/lib/format';

/**
 * Ticket interno de 80 mm. No es un comprobante fiscal: la factura electrónica llega en la
 * Fase 5. Se imprime con el diálogo del navegador; el estilo de impresión (styles.css) oculta
 * todo lo demás y ajusta la página al ancho del rollo.
 */
export function Ticket({ sale, tenant }: { sale: SaleDto; tenant: TenantDto }) {
  return (
    <div className="ticket font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        {tenant.appearance?.logoData && <img src={tenant.appearance.logoData} alt="" className="mx-auto mb-2 h-12 max-w-40 object-contain" />}
        <div className="text-[14px] font-bold">{tenant.tradeName}</div>
        {tenant.legalName && <div>{tenant.legalName}</div>}
        {tenant.cuit && <div>CUIT {formatCuit(tenant.cuit)}</div>}
        <div>{TAX_CONDITION_LABELS[tenant.taxCondition]}</div>
        {tenant.address && <div>{tenant.address}</div>}
        <div>{sale.branchName}</div>
      </div>
      <hr className="my-1 border-dashed border-black" />
      <div>Venta N° {String(sale.number).padStart(8, '0')}</div>
      <div>{formatDateTime(sale.confirmedAt)}</div>
      <div>
        {sale.registerName} · Atendió: {sale.cashierName}
      </div>
      <hr className="my-1 border-dashed border-black" />
      {sale.lines.map((l) => (
        <div key={l.id} className="mb-0.5">
          <div>{l.description}</div>
          <div className="flex justify-between">
            <span>
              {formatQty(l.quantity, l.saleMode)} x {formatArs(l.unitPrice)}
              {l.discountPercent !== '0.00' && ` −${l.discountPercent.replace('.', ',')}%`}
            </span>
            <span>{formatArs(l.total)}</span>
          </div>
        </div>
      ))}
      <hr className="my-1 border-dashed border-black" />
      {sale.discountTotal !== '0.00' && (
        <>
          <Row label="Subtotal" value={formatArs(sale.subtotal)} />
          <Row label="Descuentos" value={`−${formatArs(sale.discountTotal)}`} />
        </>
      )}
      <div className="flex justify-between text-[15px] font-bold">
        <span>TOTAL</span>
        <span>{formatArs(sale.total)}</span>
      </div>
      {sale.payments.map((p, i) => (
        <Row key={i} label={p.name} value={formatArs(p.kind === 'cash' && i === lastCash(sale) ? addChange(p.amount, sale.changeGiven) : p.amount)} />
      ))}
      {sale.changeGiven !== '0.00' && <Row label="Su vuelto" value={formatArs(sale.changeGiven)} />}
      {sale.status === 'voided' && <div className="mt-1 text-center font-bold">*** VENTA ANULADA ***</div>}
      <hr className="my-1 border-dashed border-black" />
      <div className="text-center font-bold">Comprobante no válido como factura</div>
      <div className="text-center">¡Gracias por su compra!</div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

/** El vuelto se descontó del último pago en efectivo; en el ticket se muestra lo entregado. */
function lastCash(sale: SaleDto) {
  for (let i = sale.payments.length - 1; i >= 0; i--) if (sale.payments[i]!.kind === 'cash') return i;
  return -1;
}
const addChange = (amount: string, change: string) => roundMoney(dec(amount).plus(dec(change)));

/** Imprime el ticket en cuanto se monta y avisa al terminar. */
export function PrintTicket({ sale, tenant, onDone }: { sale: SaleDto; tenant: TenantDto; onDone: () => void }) {
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener('afterprint', after, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => (window.clearTimeout(t), window.removeEventListener('afterprint', after));
  }, [onDone]);
  return createPortal(
    <div id="print-root">
      <Ticket sale={sale} tenant={tenant} />
    </div>,
    document.body,
  );
}
