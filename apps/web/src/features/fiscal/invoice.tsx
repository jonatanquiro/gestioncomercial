import type { SaleDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Alert, Spinner } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatCuit } from '@/lib/format';

export type Environment = 'homologacion' | 'produccion';
export type Invoice = { id: string; saleId: string; environment: Environment; cuit: string; pointOfSale: number; voucherType: number; number: number; status: string; cae: string | null; caeExpiresOn: string | null; message: string | null; payload: { request: Record<string, string | number>; buyerName: string; buyerAddress: string | null; issuerName: string; issuerAddress: string | null; issuerTaxCondition?: string; issuerMetadata?: { grossIncomeNumber?: string; activityStartDate?: string } } };
export const TYPES: Record<number, string> = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' };

/** Comprobante autorizado listo para imprimir, con CAE y QR de ARCA generado en el equipo. */
export function InvoicePrint({ invoice: i, onClose }: { invoice: Invoice; onClose: () => void }) {
  const sale = useQuery({ queryKey: ['sales', 'print-fiscal', i.saleId], queryFn: () => http.get<SaleDto>(`/sales/${i.saleId}`) });
  const [qr, setQr] = useState('');
  const r = i.payload.request;
  useEffect(() => {
    const date = String(r.CbteFch);
    const data = { ver: 1, fecha: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, cuit: Number(i.cuit), ptoVta: i.pointOfSale, tipoCmp: i.voucherType, nroCmp: i.number, importe: Number(r.ImpTotal), moneda: 'PES', ctz: 1, tipoDocRec: Number(r.DocTipo), nroDocRec: Number(r.DocNro), tipoCodAut: 'E', codAut: Number(i.cae) };
    let active = true;
    void QRCode.toDataURL(`https://www.arca.gob.ar/fe/qr/?p=${encodeURIComponent(btoa(JSON.stringify(data)))}`, { width: 160, margin: 1 }).then(value => { if (active) setQr(value); });
    return () => { active = false; };
  }, [i, r]);
  useEffect(() => {
    if (!qr || !sale.data) return;
    const done = () => onClose();
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 300);
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done); };
  }, [qr, sale.data, onClose]);
  if (!sale.data) return sale.error ? <Alert>{errorMessage(sale.error)}</Alert> : <Spinner label="Preparando comprobante…" />;
  return createPortal(<div id="print-root"><div className="font-sans text-[12px] text-black">
    {i.environment === 'homologacion' && <p className="mb-3 border-2 border-black p-2 text-center font-bold">PRUEBA DE HOMOLOGACIÓN · SIN VALIDEZ FISCAL</p>}
    <h1 className="text-lg font-bold">{TYPES[i.voucherType]} · Código {String(i.voucherType).padStart(3, '0')}</h1><p>ORIGINAL · {String(i.pointOfSale).padStart(5, '0')}-{String(i.number).padStart(8, '0')}</p><p>Fecha: {String(r.CbteFch)}</p><hr className="my-2" />
    <p className="font-bold">{i.payload.issuerName}</p><p>CUIT: {formatCuit(i.cuit)}</p><p>{i.payload.issuerAddress}</p><p>{i.payload.issuerTaxCondition === 'responsable_inscripto' ? 'IVA Responsable Inscripto' : i.payload.issuerTaxCondition === 'exento' ? 'IVA Exento' : 'Responsable Monotributo'}</p><p>Ingresos Brutos: {i.payload.issuerMetadata?.grossIncomeNumber || 'Sin informar (prueba)'}</p><p>Inicio de actividades: {i.payload.issuerMetadata?.activityStartDate || 'Sin informar (prueba)'}</p><hr className="my-2" /><p>Receptor: {i.payload.buyerName}</p><p>Documento: {r.DocTipo} · {r.DocNro}</p><p>Condición IVA: {r.CondicionIVAReceptorId}</p><p>{i.payload.buyerAddress}</p><hr className="my-2" />
    {sale.data.lines.map(l => <div key={l.id} className="mb-2"><p>{l.description}</p><p>{l.quantity} × {formatArs(l.unitPrice)} · {formatArs(l.total)}</p></div>)}
    <hr className="my-2" />{i.voucherType === 1 && <><p>Neto gravado: {formatArs(String(r.ImpNeto))}</p><p>IVA: {formatArs(String(r.ImpIVA))}</p><p>Exento: {formatArs(String(r.ImpOpEx))} · No gravado: {formatArs(String(r.ImpTotConc))}</p></>}<p className="text-lg font-bold">TOTAL {formatArs(String(r.ImpTotal))}</p><p>Moneda: ARS · Cotización: 1</p>{i.voucherType !== 11 && <div className="mt-2 text-xs"><p>Régimen de Transparencia Fiscal al Consumidor Ley 27.743</p><p>IVA contenido: {formatArs(String(r.ImpIVA))}</p><p>Otros impuestos nacionales indirectos: $ 0,00</p></div>}{i.voucherType === 1 && Number(r.CondicionIVAReceptorId) === 6 && <p className="mt-2 text-xs">El crédito fiscal discriminado en el presente comprobante sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.</p>}<hr className="my-2" /><p>CAE: {i.cae}</p><p>Vencimiento CAE: {i.caeExpiresOn}</p>{qr && <img src={qr} alt="QR de consulta del comprobante" className="mx-auto size-32" />}<p className="text-center text-xs">Comprobante autorizado electrónicamente</p>
  </div></div>, document.body);
}
