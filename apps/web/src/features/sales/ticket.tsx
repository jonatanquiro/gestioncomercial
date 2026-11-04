import { type SaleDto, type TenantDto } from '@gc/contracts';
import { dec, formatArs, roundMoney } from '@gc/domain';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarcodeSvg } from '@/components/barcode-svg';
import { formatCuit, formatDate, formatDateTime, formatQty } from '@/lib/format';
import { exchangeDeadline, saleTicketCode } from './exchange-ticket';
import { formatGiftCardCode, GiftCardSheet, GiftCardTicket } from '@/features/gift-cards/gift-card-ticket';

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
        {tenant.address && <div>{tenant.address}</div>}
        {(tenant.phone || tenant.email) && <div>{[tenant.phone && `Tel. ${tenant.phone}`, tenant.email].filter(Boolean).join(' · ')}</div>}
        <div>{sale.branchName}</div>
      </div>
      <hr className="my-1 border-dashed border-black" />
      <div>Venta N° {String(sale.number).padStart(8, '0')}</div>
      <div>{formatDateTime(sale.confirmedAt)}</div>
      <div>
        {sale.registerName} · Atendió: {sale.cashierName}
      </div>
      {sale.customer && <div>Cliente: {sale.customer.name}</div>}
      {sale.kind === 'account_payment' && (
        <div className="flex justify-between">
          <span>Pago a cuenta corriente</span>
          <span>{formatArs(sale.total)}</span>
        </div>
      )}
      <hr className="my-1 border-dashed border-black" />
      {sale.giftCard && (
        <div className="flex justify-between">
          <span>Gift card {formatGiftCardCode(sale.giftCard.code)}</span>
          <span>{formatArs(sale.giftCard.amount)}</span>
        </div>
      )}
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
          {l.promotionName && <div>  {l.promotionName} −{formatArs(l.promotionDiscount)}</div>}
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
      {sale.priceList === 'cash' && <div>Precios de contado</div>}
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

/**
 * Ticket de cambio: lo que se llevó, sin precios (sirve también de ticket de regalo), el plazo
 * para cambiar y un código de barras con el número de venta para encontrarla escaneándolo.
 */
export function ExchangeTicket({ sale, tenant }: { sale: SaleDto; tenant: TenantDto }) {
  const deadline = exchangeDeadline(sale.confirmedAt, tenant.settings.exchangeDays);
  const lines = sale.lines.filter((l) => dec(l.quantity).gt(l.returnedQuantity));
  return (
    <div className="ticket font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        {tenant.appearance?.logoData && <img src={tenant.appearance.logoData} alt="" className="mx-auto mb-2 h-12 max-w-40 object-contain" />}
        <div className="text-[14px] font-bold">{tenant.tradeName}</div>
        {tenant.address && <div>{tenant.address}</div>}
        <div>{sale.branchName}</div>
      </div>
      <hr className="my-1 border-dashed border-black" />
      <div className="text-center text-[15px] font-bold">TICKET DE CAMBIO</div>
      <div>Venta N° {String(sale.number).padStart(8, '0')}</div>
      <div>{formatDate(sale.confirmedAt)}</div>
      <hr className="my-1 border-dashed border-black" />
      {lines.map((l) => (
        <div key={l.id} className="mb-0.5 flex gap-2">
          <span className="shrink-0">{formatQty(dec(l.quantity).minus(l.returnedQuantity).toFixed(3), l.saleMode)} x</span>
          <span>{l.description}</span>
        </div>
      ))}
      <hr className="my-1 border-dashed border-black" />
      {deadline && <div className="text-center font-bold">Válido para cambio hasta el {formatDate(deadline.toISOString())}</div>}
      <div className="text-center">Presentá este ticket para cambiar talle, color o artículo.</div>
      <BarcodeSvg code={saleTicketCode(sale.number)} className="mx-auto mt-2 h-14 w-48" />
      <div className="text-center tracking-[0.2em]">{saleTicketCode(sale.number)}</div>
    </div>
  );
}

/** Qué se imprime de una venta: el ticket, el de cambio o la gift card (en hoja común o en el rollo). */
export type PrintKind = 'sale' | 'exchange' | 'gift-sheet' | 'gift-roll';

/** Imprime en cuanto se monta y avisa al terminar. */
export function PrintTicket({ sale, tenant, onDone, kind = 'sale' }: { sale: SaleDto; tenant: TenantDto; onDone: () => void; kind?: PrintKind }) {
  useEffect(() => {
    const after = () => onDone();
    window.addEventListener('afterprint', after, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => (window.clearTimeout(t), window.removeEventListener('afterprint', after));
  }, [onDone]);
  return createPortal(
    <div id="print-root">
      {kind === 'gift-sheet' && sale.giftCard ? (
        <GiftCardSheet card={sale.giftCard} tenant={tenant} />
      ) : kind === 'gift-roll' && sale.giftCard ? (
        <GiftCardTicket card={sale.giftCard} tenant={tenant} />
      ) : kind === 'exchange' ? (
        <ExchangeTicket sale={sale} tenant={tenant} />
      ) : (
        <Ticket sale={sale} tenant={tenant} />
      )}
    </div>,
    document.body,
  );
}
