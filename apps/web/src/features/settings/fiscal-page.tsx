import type { Paginated, SaleDto, SaleSummaryDto, TenantDto } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { Forbidden } from '@/features/layout/app-layout';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatCuit } from '@/lib/format';
import { useCan } from '@/lib/session';

type Environment = 'homologacion' | 'produccion';
type Setting = { environment: Environment; cuit: string; pointOfSale: number; credentialMode: 'own' | 'delegated'; hasCertificate: boolean; hasPrivateKey: boolean; certificateExpiresOn: string | null; csr: string | null; grossIncomeNumber: string | null; activityStartDate: string | null };
export type Invoice = { id: string; saleId: string; environment: Environment; cuit: string; pointOfSale: number; voucherType: number; number: number; status: string; cae: string | null; caeExpiresOn: string | null; message: string | null; payload: { request: Record<string, string | number>; buyerName: string; buyerAddress: string | null; issuerName: string; issuerAddress: string | null; issuerTaxCondition?: string; issuerMetadata?: { grossIncomeNumber?: string; activityStartDate?: string } } };
const TYPES: Record<number, string> = { 1: 'Factura A', 6: 'Factura B', 11: 'Factura C' };

export function FiscalPage() {
  const allowed = useCan()('fiscal.manage');
  const search = useSearch({ from: '/app/facturacion' });
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant'), enabled: allowed });
  const settings = useQuery({ queryKey: ['fiscal-settings'], queryFn: () => http.get<Setting[]>('/fiscal/settings'), enabled: allowed });
  const [environment, setEnvironment] = useState<Environment>('homologacion');
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const invoices = useQuery({ queryKey: ['fiscal-invoices'], queryFn: () => http.get<Invoice[]>('/fiscal/invoices'), enabled: allowed });
  if (!allowed) return <Forbidden />;
  return <>
    <PageHeader title="Facturación ARCA" description="Certificados, conexión y comprobantes asociados a las ventas. Cada comercio usa sus propias credenciales." />
    <div className="mb-5"><Alert kind="info">Primero probá el circuito completo en homologación. Esta versión emite facturas A, B y C de bienes en pesos, sin otros tributos. No cubre impuestos internos, notas de crédito, servicios, exportaciones ni comprobantes especiales. Una venta con factura real no puede anularse ni devolverse desde caja hasta resolver la nota de crédito fiscal.</Alert></div>
    <div className="mb-5 max-w-xs"><Field label="Ambiente">{p => <Select {...p} value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="homologacion">Homologación · pruebas</option><option value="produccion">Producción · comprobantes reales</option></Select>}</Field></div>
    {settings.isLoading && <Spinner />}{settings.error && <Alert>{errorMessage(settings.error)}</Alert>}
    {settings.data && <FiscalConfig key={environment} environment={environment} setting={settings.data.find(s => s.environment === environment)} defaultCuit={tenant.data?.cuit ?? ''} />}
    <div className="mt-6"><IssueForm environment={environment} defaultSaleId={search.saleId} taxCondition={tenant.data?.taxCondition} /></div>
    <Card className="mt-6"><h2 className="border-b border-slate-200 p-4 font-semibold">Últimos comprobantes</h2>{invoices.error && <Alert>{errorMessage(invoices.error)}</Alert>}<Table head={<><Th>Comprobante</Th><Th>Ambiente</Th><Th>Estado / CAE</Th><Th /></>}>{invoices.data?.map(i => <tr key={i.id}><Td>{TYPES[i.voucherType]} · {i.pointOfSale}-{i.number}<p className="text-xs text-slate-500">{i.payload.buyerName}</p></Td><Td>{i.environment}</Td><Td><Badge tone={i.status === 'authorized' ? 'green' : i.status === 'rejected' ? 'red' : 'amber'}>{i.status === 'authorized' ? 'Autorizado' : i.status === 'rejected' ? 'Rechazado' : 'Pendiente de respuesta'}</Badge><p className="mt-1 text-xs">{i.cae}</p><p className="max-w-lg text-xs text-red-700">{i.message}</p></Td><Td>{i.status === 'authorized' && <Button size="sm" variant="secondary" onClick={() => setPrinting(i)}>Ver / imprimir</Button>}</Td></tr>)}</Table></Card>
    {printing && <InvoicePrint invoice={printing} onClose={() => setPrinting(null)} />}
  </>;
}

/** Los errores de validación muestran el motivo de cada campo, no solo el mensaje general. */
const detailedError = (err: unknown) => (err instanceof ApiRequestError && Object.keys(err.fieldErrors()).length ? Object.values(err.fieldErrors()).join(' · ') : errorMessage(err));

function FiscalConfig({ environment, setting, defaultCuit }: { environment: Environment; setting?: Setting; defaultCuit: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const [cuit, setCuit] = useState(setting?.cuit ?? defaultCuit);
  const [point, setPoint] = useState(String(setting?.pointOfSale ?? 1));
  const [mode, setMode] = useState(setting?.credentialMode ?? 'own');
  const [grossIncome, setGrossIncome] = useState(setting?.grossIncomeNumber ?? '');
  const [started, setStarted] = useState(setting?.activityStartDate ?? '');
  const [certificate, setCertificate] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [alias, setAlias] = useState('kiosco');
  const [organization, setOrganization] = useState('');
  const [csr, setCsr] = useState(setting?.csr ?? '');
  const [fileError, setFileError] = useState('');
  const save = useMutation({ mutationFn: () => http.put('/fiscal/settings', { environment, cuit, pointOfSale: Number(point), credentialMode: mode, grossIncomeNumber: grossIncome || null, activityStartDate: started || null, certificatePem: certificate || null, privateKeyPem: privateKey || null }), onSuccess: async () => { setCertificate(''); setPrivateKey(''); await client.invalidateQueries({ queryKey: ['fiscal-settings'] }); toast('Configuración fiscal guardada'); } });
  const generate = useMutation({ mutationFn: () => http.post<{ csr: string }>('/fiscal/csr', { environment, cuit, alias, organization }), onSuccess: async data => { setCsr(data.csr); await client.invalidateQueries({ queryKey: ['fiscal-settings'] }); toast('Pedido de certificado generado'); } });
  const check = useMutation({ mutationFn: () => http.post<{ pointsOfSale: { number: number; type: string; blocked: string; closedOn: string }[] }>('/fiscal/check', { environment }) });
  const read = async (file: File | undefined, setter: (v: string) => void) => { if (!file) return; if (file.size > 20000) return setFileError('El archivo supera los 20 KB'); setFileError(''); setter(await file.text()); };
  return <Card className="space-y-5 p-6"><h2 className="font-semibold">Certificado y punto de venta · {environment}</h2>
    {(fileError || save.error || generate.error || check.error) && <Alert>{fileError || detailedError(save.error ?? generate.error ?? check.error)}</Alert>}
    <div className="grid gap-4 md:grid-cols-3"><Field label="CUIT del emisor">{p => <Input {...p} value={cuit} onChange={e => setCuit(e.target.value)} />}</Field><Field label="Punto de venta" hint="Usá un punto de venta dedicado a este sistema, sin emitir desde otras aplicaciones con la misma numeración.">{p => <Input {...p} type="number" min={1} max={99999} value={point} onChange={e => setPoint(e.target.value)} />}</Field><Field label="Titular del certificado">{p => <Select {...p} value={mode} onChange={e => setMode(e.target.value as 'own' | 'delegated')}><option value="own">Certificado propio</option><option value="delegated">Certificado con servicio delegado</option></Select>}</Field></div>
    <p className="text-xs text-slate-500">{setting?.hasCertificate ? `Certificado cargado · vence ${setting.certificateExpiresOn}` : 'Sin certificado cargado'}. {setting?.hasPrivateKey ? 'Clave privada guardada de forma cifrada.' : 'Podés generar la clave y el pedido desde acá, o importar un par existente.'} Las credenciales guardadas no se descargan ni se muestran.</p>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Ingresos Brutos / condición de exención">{p => <Input {...p} maxLength={60} value={grossIncome} onChange={e => setGrossIncome(e.target.value)} />}</Field><Field label="Inicio de actividades">{p => <Input {...p} type="date" value={started} onChange={e => setStarted(e.target.value)} />}</Field></div>
    <div className="grid gap-4 md:grid-cols-2"><Field label="Certificado PEM (.crt / .pem)">{p => <Input {...p} type="file" accept=".crt,.pem" onChange={e => void read(e.target.files?.[0], setCertificate)} />}</Field><Field label="Clave privada PEM (solo al importar una existente)" hint={setting?.hasPrivateKey ? 'Si generaste el pedido desde acá, dejala vacía: el sistema ya tiene la clave.' : undefined}>{p => <Input {...p} type="file" accept=".key,.pem" onChange={e => void read(e.target.files?.[0], setPrivateKey)} />}</Field></div>
    <div className="flex flex-wrap gap-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Guardar configuración</Button><Button variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>Probar conexión y puntos de venta</Button></div>
    {check.data && <Alert kind="success">Conexión verificada. Puntos de venta: {check.data.pointsOfSale.map(p => `${p.number} (${p.type}${p.blocked === 'S' ? ', bloqueado' : ''}${p.closedOn && p.closedOn !== 'NULL' ? `, baja ${p.closedOn}` : ''})`).join(' · ') || (environment === 'homologacion' ? 'ARCA no informa puntos de venta; en homologación es normal y podés usar cualquier número.' : 'ARCA no informa puntos de venta de web services: dalo de alta en ARCA como «Factura electrónica - Monotributo / RI Web Services».')}</Alert>}
    <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold">Generar un pedido de certificado (CSR)</summary><div className="mt-4 space-y-4"><p className="text-sm text-slate-500">La clave se genera y guarda en este sistema. Subí el pedido a WSASS para homologación o a Administración de Certificados Digitales para producción y asociá el certificado al servicio WSFE. Después cargá el certificado recibido. No se necesitan las claves de otro sistema.</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Alias (letras, números, guion)">{p => <Input {...p} value={alias} onChange={e => setAlias(e.target.value)} />}</Field><Field label="Razón social para el pedido">{p => <Input {...p} value={organization} onChange={e => setOrganization(e.target.value)} />}</Field></div><Button variant="secondary" loading={generate.isPending} onClick={() => generate.mutate()}>Generar CSR</Button>{csr && <Field label="Pedido para copiar en ARCA">{p => <textarea {...p} readOnly value={csr} className="h-48 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs" />}</Field>}</div></details>
  </Card>;
}

function IssueForm({ environment, defaultSaleId, taxCondition }: { environment: Environment; defaultSaleId?: string; taxCondition?: string }) {
  const client = useQueryClient();
  const [saleId, setSaleId] = useState(defaultSaleId ?? '');
  const [type, setType] = useState(taxCondition === 'responsable_inscripto' ? '6' : '11');
  const [docType, setDocType] = useState('99');
  const [docNumber, setDocNumber] = useState('0');
  const [buyer, setBuyer] = useState('Consumidor final');
  const [address, setAddress] = useState('');
  const [condition, setCondition] = useState('5');
  const [confirm, setConfirm] = useState(false);
  const sales = useQuery({ queryKey: ['sales', 'fiscal-picker'], queryFn: () => http.get<Paginated<SaleSummaryDto>>('/sales?pageSize=100') });
  const selected = useQuery({ queryKey: ['sales', 'fiscal', saleId], queryFn: () => http.get<SaleDto>(`/sales/${saleId}`), enabled: !!saleId });
  const issue = useMutation({ mutationFn: () => http.post<Invoice>(`/sales/${saleId}/invoice`, { environment, voucherType: Number(type), documentType: Number(docType), documentNumber: docNumber, buyerName: buyer, buyerAddress: address || null, vatCondition: Number(condition), confirmProduction: confirm }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['fiscal-invoices'] }); } });
  return <Card className="space-y-4 p-6"><h2 className="font-semibold">Facturar una venta / consultar un intento pendiente</h2>
    {(issue.error || sales.error || selected.error) && <Alert>{errorMessage(issue.error ?? sales.error ?? selected.error)}</Alert>}
    {issue.data && <Alert kind={issue.data.status === 'authorized' ? 'success' : 'info'}>{issue.data.status === 'authorized' ? `Autorizado: ${TYPES[issue.data.voucherType]} ${issue.data.pointOfSale}-${issue.data.number} · CAE ${issue.data.cae}` : issue.data.message || 'La solicitud sigue pendiente. Reintentá esta misma venta para consultar su resultado.'}</Alert>}
    <Field label="Venta confirmada">{p => <Select {...p} value={saleId} onChange={e => setSaleId(e.target.value)}><option value="">Elegí una venta (últimas 100)</option>{defaultSaleId && !sales.data?.items.some(s => s.id === defaultSaleId) && <option value={defaultSaleId}>Venta elegida desde el detalle</option>}{sales.data?.items.filter(s => s.status === 'confirmed').map(s => <option key={s.id} value={s.id}>Venta {s.number} · {s.registerName} · {formatArs(s.total)}</option>)}</Select>}</Field>
    {selected.data && <p className="text-sm">Venta {selected.data.number} · Importe total: <strong>{formatArs(selected.data.total)}</strong></p>}
    <div className="grid gap-4 md:grid-cols-3"><Field label="Comprobante">{p => <Select {...p} value={type} onChange={e => setType(e.target.value)}>{Object.entries(TYPES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>}</Field><Field label="Documento del receptor">{p => <Select {...p} value={docType} onChange={e => { setDocType(e.target.value); setDocNumber(e.target.value === '99' ? '0' : ''); }}><option value="99">Consumidor final sin identificar</option><option value="96">DNI</option><option value="80">CUIT</option></Select>}</Field><Field label="Número de documento">{p => <Input {...p} inputMode="numeric" value={docNumber} onChange={e => setDocNumber(e.target.value)} />}</Field></div>
    <div className="grid gap-4 md:grid-cols-3"><Field label="Nombre / razón social del receptor">{p => <Input {...p} maxLength={160} value={buyer} onChange={e => setBuyer(e.target.value)} />}</Field><Field label="Domicilio del receptor">{p => <Input {...p} maxLength={200} value={address} onChange={e => setAddress(e.target.value)} />}</Field><Field label="Condición IVA del receptor">{p => <Select {...p} value={condition} onChange={e => setCondition(e.target.value)}><option value="5">Consumidor final</option><option value="1">Responsable inscripto</option><option value="6">Monotributista</option><option value="4">Exento</option></Select>}</Field></div>
    <p className="text-xs text-slate-500">ARCA valida la identificación requerida y la habilitación del tipo de comprobante. Si solicita identificar al consumidor, cargá DNI o CUIT. Ante un timeout, el reintento consulta el mismo número y conserva el pedido original. Un rechazo confirmado permite corregir los datos y reintentar.</p>
    {environment === 'produccion' && <label className="flex items-start gap-3 text-sm font-semibold text-red-800"><input type="checkbox" className="mt-1 size-4" checked={confirm} onChange={e => setConfirm(e.target.checked)} />Confirmo que quiero emitir una factura real, revisé sus datos fiscales y la venta no requiere impuestos internos ni otros tributos adicionales.</label>}
    <Button disabled={!saleId || (environment === 'produccion' && !confirm)} loading={issue.isPending} onClick={() => issue.mutate()}>{environment === 'homologacion' ? 'Emitir / consultar en homologación' : 'Emitir / consultar factura real'}</Button>
  </Card>;
}

function InvoicePrint({ invoice: i, onClose }: { invoice: Invoice; onClose: () => void }) {
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
