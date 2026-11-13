import { type GiftCardDto, type TenantDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { BarcodeSvg } from '@/components/barcode-svg';
import { formatDate } from '@/lib/format';

/** «GCABCDEFGHJK» en grupos de cuatro para leerlo y dictarlo sin errores. */
export const formatGiftCardCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ');

/** Último día de uso, sin correrse por la zona horaria: expiresOn es una fecha sin hora. */
export const formatExpiry = (expiresOn: string) => formatDate(`${expiresOn}T12:00:00`);

const CONDITIONS = 'Se usa en una o varias compras, en cualquier sucursal, hasta agotar el saldo. No se canjea por dinero.';

/** Gift card en el rollo de 80 mm: con guardas y el monto grande, para entregarla como regalo. */
export function GiftCardTicket({ card, tenant }: { card: GiftCardDto; tenant: TenantDto }) {
  return (
    <div className="ticket font-mono text-[12px] leading-snug text-black">
      <div className="rounded-[10px] border-2 border-double border-black px-3 py-3">
        <div className="text-center">
          {tenant.appearance?.logoData && <img src={tenant.appearance.logoData} alt="" className="mx-auto mb-1 h-12 max-w-40 object-contain" />}
          <div className="text-[14px] font-bold">{tenant.tradeName}</div>
        </div>
        <div className="my-2 text-center text-[11px] tracking-[0.3em]">✦ ✦ ✦</div>
        <div className="text-center font-serif text-[18px] italic">Tarjeta de regalo</div>
        <div className="my-2 text-center text-[26px] font-bold">{formatArs(card.amount)}</div>
        {card.recipientName && <div className="text-center text-[14px]">Para {card.recipientName}</div>}
        {card.message && <div className="mx-auto my-2 max-w-[60mm] whitespace-pre-line text-center font-serif italic">«{card.message}»</div>}
        {card.fromName && <div className="text-center">Con cariño, {card.fromName}</div>}
        <div className="my-2 text-center text-[11px] tracking-[0.3em]">✦ ✦ ✦</div>
        <div className="text-center font-bold">Válida hasta el {formatExpiry(card.expiresOn)}</div>
        <BarcodeSvg code={card.code} className="mx-auto mt-2 h-14 w-60" />
        <div className="text-center text-[13px] font-bold tracking-[0.15em]">{formatGiftCardCode(card.code)}</div>
      </div>
      <div className="mt-1 text-center text-[10px]">{CONDITIONS}</div>
    </div>
  );
}

/**
 * Gift card para imprimir en una hoja común (A4 o carta) y recortar: tarjeta a color con el
 * logo y el color del comercio, el monto, la dedicatoria y el código para usarla.
 */
export function GiftCardSheet({ card, tenant }: { card: GiftCardDto; tenant: TenantDto }) {
  const color = tenant.appearance?.primaryColor ?? '#1f6f4a';
  const tint = `color-mix(in srgb, ${color} 10%, white)`;
  return (
    <div className="gift-sheet text-slate-900" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
      <style>{`@media print { @page { size: A4 portrait; margin: 14mm; } #print-root { width: auto !important; } .gift-sheet, .gift-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="mx-auto w-[170mm] rounded-[4mm] border border-dashed border-slate-400 p-[3mm]">
        <div className="relative h-[100mm] overflow-hidden rounded-[3mm]" style={{ background: tint }}>
          {/* Guardas decorativas con el color del comercio. */}
          <div className="absolute -right-[18mm] -top-[18mm] size-[60mm] rounded-full opacity-90" style={{ background: color }} />
          <div className="absolute -right-[4mm] top-[30mm] size-[22mm] rounded-full opacity-40" style={{ background: color }} />
          <div className="absolute -bottom-[22mm] -left-[14mm] size-[48mm] rounded-full opacity-25" style={{ background: color }} />
          <div className="absolute left-0 top-0 h-full w-[4mm]" style={{ background: color }} />

          <div className="relative flex h-full flex-col px-[12mm] py-[9mm]">
            <div className="flex items-center gap-[4mm]">
              {tenant.appearance?.logoData && <img src={tenant.appearance.logoData} alt="" className="h-[14mm] max-w-[40mm] rounded-[2mm] bg-white object-contain p-[1mm]" />}
              <div className="font-sans text-[15pt] font-bold leading-tight">{tenant.tradeName}</div>
            </div>
            <div className="absolute right-[9mm] top-[12mm] text-right font-sans text-[10pt] font-bold uppercase tracking-[0.25em] text-white">
              Gift
              <br />
              card
            </div>

            <div className="mt-[6mm] text-[13pt] italic text-slate-700">Tarjeta de regalo{card.recipientName ? ` para ${card.recipientName}` : ''}</div>
            <div className="font-sans text-[34pt] font-extrabold leading-none tracking-tight" style={{ color }}>
              {formatArs(card.amount)}
            </div>
            {card.message && <div className="mt-[4mm] max-w-[110mm] whitespace-pre-line text-[12pt] italic leading-snug text-slate-800">«{card.message}»</div>}
            {card.fromName && <div className="mt-[2mm] text-[11pt] text-slate-700">Con cariño, {card.fromName}</div>}

            <div className="mt-auto flex items-end justify-between gap-[6mm]">
              <div className="font-sans text-[8.5pt] leading-snug text-slate-600">
                <div className="text-[10pt] font-bold text-slate-900">Válida hasta el {formatExpiry(card.expiresOn)}</div>
                <div className="max-w-[80mm]">{CONDITIONS}</div>
                {(tenant.address || tenant.phone) && <div className="mt-[1mm]">{[tenant.address, tenant.phone && `Tel. ${tenant.phone}`].filter(Boolean).join(' · ')}</div>}
              </div>
              <div className="shrink-0 rounded-[2mm] bg-white px-[3mm] pb-[1.5mm] pt-[2mm] text-center">
                <BarcodeSvg code={card.code} className="h-[12mm] w-[52mm]" />
                <div className="font-mono text-[9pt] font-bold tracking-[0.15em]">{formatGiftCardCode(card.code)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-[3mm] text-center font-sans text-[8pt] text-slate-500">✂ Recortá por la línea punteada</p>
    </div>
  );
}
