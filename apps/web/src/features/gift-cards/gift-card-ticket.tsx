import { type GiftCardDto, type TenantDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { BarcodeSvg } from '@/components/barcode-svg';
import { formatDate } from '@/lib/format';

/** «GCABCDEFGHJK» en grupos de cuatro para leerlo y dictarlo sin errores. */
export const formatGiftCardCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ');

/** Último día de uso, sin correrse por la zona horaria: expiresOn es una fecha sin hora. */
export const formatExpiry = (expiresOn: string) => formatDate(`${expiresOn}T12:00:00`);

/** Gift card impresa en el rollo de 80 mm: monto, para quién, vencimiento y el código para usarla. */
export function GiftCardTicket({ card, tenant }: { card: GiftCardDto; tenant: TenantDto }) {
  return (
    <div className="ticket font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        {tenant.appearance?.logoData && <img src={tenant.appearance.logoData} alt="" className="mx-auto mb-2 h-12 max-w-40 object-contain" />}
        <div className="text-[14px] font-bold">{tenant.tradeName}</div>
        {tenant.address && <div>{tenant.address}</div>}
      </div>
      <hr className="my-1 border-dashed border-black" />
      <div className="text-center text-[15px] font-bold">GIFT CARD</div>
      <div className="my-1 text-center text-[22px] font-bold">{formatArs(card.amount)}</div>
      {card.recipientName && <div className="text-center">Para: {card.recipientName}</div>}
      {card.fromName && <div className="text-center">De: {card.fromName}</div>}
      <hr className="my-1 border-dashed border-black" />
      <div className="text-center font-bold">Válida hasta el {formatExpiry(card.expiresOn)}</div>
      <div className="text-center">Se usa en una o varias compras, en cualquier sucursal, hasta agotar el saldo. No se canjea por dinero.</div>
      <BarcodeSvg code={card.code} className="mx-auto mt-2 h-14 w-60" />
      <div className="text-center text-[13px] font-bold tracking-[0.15em]">{formatGiftCardCode(card.code)}</div>
    </div>
  );
}
