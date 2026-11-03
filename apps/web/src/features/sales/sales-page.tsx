import { type Paginated, type PermissionCode, type SaleDto, type SaleSummaryDto } from '@gc/contracts';
import { dec, formatArs, proportionalAmount, roundMoney, sumMoney } from '@gc/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Gift, Printer } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid, tenantQuery } from '@/features/catalog/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ActionMenu } from '@/components/ui/menu';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatDateTime, formatQty, parseDecimalInput } from '@/lib/format';
import { useCan } from '@/lib/session';
import { paymentMethodsQuery, registersQuery } from './queries';
import { useAuthorized } from './use-authorized';
import { ExchangeDialog } from './exchange-dialog';
import { PrintTicket } from './ticket';
import { parseSaleTicketCode } from './exchange-ticket';
import { InvoiceDialog, invoiceNumber, saleInvoicesQuery } from '@/features/fiscal/invoice-dialog';
import { type Invoice, InvoicePrint } from '@/features/fiscal/invoice';
import { CreditNoteDialog } from '@/features/fiscal/credit-note-dialog';
import { formatExpiry, formatGiftCardCode } from '@/features/gift-cards/gift-card-ticket';
import { GIFT_CARD_STATES, GiftCardDetailDialog } from '@/features/gift-cards/gift-cards-page';

const PAGE_SIZE = 25;

export function SalesPage() {
  const can = useCan();
  const allowed = can('sales.read_own', 'sales.read_all');
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/ventas' });
  const [page, setPage] = useState(1);
  const [number, setNumber] = useState(search.numero ? String(search.numero) : '');
  const [day, setDay] = useState('');
  // Con el lector sobre un ticket de cambio llega «V123»: se busca la venta 123.
  const wanted = parseSaleTicketCode(number) ?? (/^\d+$/.test(number.trim()) ? Number(number.trim()) : null);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (wanted !== null) params.set('number', String(wanted));
  if (day) (params.set('from', day), params.set('to', day));
  const sales = useQuery({ queryKey: ['sales', params.toString()], queryFn: () => http.get<Paginated<SaleSummaryDto>>(`/sales?${params}`), enabled: allowed });
  const only = wanted !== null && sales.data?.items.length === 1 ? sales.data.items[0]! : null;

  // Si se llegó escaneando el ticket en la caja y hay una sola venta con ese número, se abre directo.
  useEffect(() => {
    if (search.numero && only && only.number === search.numero) void navigate({ to: '/app/ventas/$id', params: { id: only.id }, replace: true });
  }, [search.numero, only, navigate]);

  function onNumberKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && only) void navigate({ to: '/app/ventas/$id', params: { id: only.id } });
  }

  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="Ventas"
        description={can('sales.read_all') ? 'Todas las ventas del comercio.' : 'Las ventas que cobraste vos.'}
        actions={
          can('sales.create') ? (
            <Link to="/app/vender" className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
              Vender
            </Link>
          ) : undefined
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <Input aria-label="Número de venta" placeholder="N° o ticket de cambio" className="w-52" value={number} onChange={(e) => (setNumber(e.target.value), setPage(1))} onKeyDown={onNumberKey} />
          <Input aria-label="Día" type="date" className="w-48" value={day} onChange={(e) => (setDay(e.target.value), setPage(1))} />
        </div>
        {sales.isLoading && <Spinner />}
        {sales.error && <Alert>{errorMessage(sales.error)}</Alert>}
        {sales.data && sales.data.items.length === 0 && <EmptyState>No hay ventas con esos filtros.</EmptyState>}
        {sales.data && sales.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>N°</Th>
                <Th>Fecha</Th>
                <Th>Caja</Th>
                <Th>Atendió</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
              </>
            }
          >
            {sales.data.items.map((s) => (
              <tr key={s.id}>
                <Td>
                  <Link to="/app/ventas/$id" params={{ id: s.id }} className="-my-2 inline-flex min-h-10 min-w-10 items-center font-semibold text-brand-700 hover:underline">
                    {s.number}
                  </Link>
                </Td>
                <Td>{formatDateTime(s.confirmedAt)}</Td>
                <Td>{s.registerName}</Td>
                <Td>
                  {s.cashierName}
                  {s.customerName && <span className="block text-xs text-slate-500">Cliente: {s.customerName}</span>}
                </Td>
                <Td className="text-right font-semibold">{formatArs(s.total)}</Td>
                <Td>
                  {s.status === 'voided' ? (
                    <Badge tone="red">Anulada</Badge>
                  ) : dec(s.returnedTotal).gt(0) ? (
                    <Badge tone="amber">Devolución {formatArs(s.returnedTotal)}</Badge>
                  ) : s.giftCardCode ? (
                    <Badge tone="brand">Gift card</Badge>
                  ) : s.kind === 'account_payment' ? (
                    <Badge tone="brand">Cobro de cuenta</Badge>
                  ) : (
                    <Badge tone="green">Cobrada</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {sales.data && <Pager page={page} pageSize={PAGE_SIZE} total={sales.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function SaleDetailPage() {
  const { id } = useParams({ from: '/app/ventas/$id' });
  const can = useCan();
  const sale = useQuery({ queryKey: ['sales', 'detail', id], queryFn: () => http.get<SaleDto>(`/sales/${id}`) });
  const tenant = useQuery(tenantQuery);
  const [printing, setPrinting] = useState<'sale' | 'exchange' | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [showingCard, setShowingCard] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const canInvoice = can('fiscal.issue', 'fiscal.manage');
  const invoices = useQuery({ ...saleInvoicesQuery(id), enabled: canInvoice });
  const [printingInvoice, setPrintingInvoice] = useState<NonNullable<typeof invoices.data>[number] | null>(null);
  const [crediting, setCrediting] = useState<{ saleReturnId: string | null; amount: string } | null>(null);

  if (!can('sales.read_own', 'sales.read_all')) return <Forbidden />;
  if (sale.isLoading) return <Spinner />;
  if (sale.error) return <Alert>{errorMessage(sale.error)}</Alert>;
  const s = sale.data!;
  const returnable = s.lines.some((l) => dec(l.quantity).gt(l.returnedQuantity));
  // Factura autorizada (la de producción si hay) y la nota de crédito de cada devolución o de la anulación (ADR 0017).
  const authorized = (invoices.data ?? []).filter((i) => i.kind === 'invoice' && i.status === 'authorized');
  const invoice = authorized.find((i) => i.environment === 'produccion') ?? authorized[0];
  const noteFor = (saleReturnId: string | null): Invoice | undefined =>
    (invoices.data ?? []).find((i) => i.kind === 'credit_note' && i.environment === invoice?.environment && i.saleReturnId === saleReturnId);
  const voidNote = invoice && s.status === 'voided' ? noteFor(null) : undefined;

  return (
    <>
      <PageHeader
        title={`Venta N° ${s.number}`}
        description={`${formatDateTime(s.confirmedAt)} · ${s.branchName} · ${s.registerName} · Atendió ${s.cashierName}${s.customer ? ` · Cliente: ${s.customer.name}` : ''}`}
        actions={
          <>
            <Button variant="secondary" disabled={!tenant.data} onClick={() => setPrinting('sale')}>
              <Printer className="size-4" /> Reimprimir ticket
            </Button>
            {s.status === 'confirmed' && (s.giftCard ? s.giftCard.state === 'active' : returnable) && (
              <Button variant="secondary" disabled={!tenant.data} onClick={() => setPrinting('exchange')}>
                <Printer className="size-4" /> {s.giftCard ? 'Imprimir gift card' : 'Ticket de cambio'}
              </Button>
            )}
            {canInvoice && s.status === 'confirmed' && s.returns.length === 0 && s.kind === 'sale' && <Button onClick={() => setInvoicing(true)}>{invoices.data?.some((i) => i.status === 'authorized') ? 'Ver factura' : 'Facturar'}</Button>}
            {s.status === 'confirmed' && can('sales.create', 'sales.return') && returnable && (
              <Button variant="secondary" onClick={() => setReturning(true)}>
                Devolución
              </Button>
            )}
            {s.status === 'confirmed' && can('sales.create') && returnable && (
              <Button variant="secondary" onClick={() => setExchanging(true)}>
                Cambio
              </Button>
            )}
            <ActionMenu label="Más acciones de la venta" text="Más" items={[{ label: 'Anular venta', danger: true, hidden: !(s.status === 'confirmed' && s.returns.length === 0 && can('sales.create', 'sales.void')), onSelect: () => setVoiding(true) }]} />
          </>
        }
      />
      {s.exchangeOf && (
        <div className="mb-4">
          <Alert kind="info">
            Es un cambio de la{' '}
            <Link to="/app/ventas/$id" params={{ id: s.exchangeOf.saleId }} className="font-semibold underline">
              venta N° {s.exchangeOf.saleNumber}
            </Link>
            : lo devuelto dejó un crédito de {formatArs(s.exchangeOf.credit)}.
          </Alert>
        </div>
      )}
      {invoice && s.status === 'voided' && voidNote?.status !== 'authorized' && (
        <div className="mb-4">
          <Alert kind="info">
            La venta estaba facturada: falta la nota de crédito por la anulación.{' '}
            <button type="button" className="font-semibold underline" onClick={() => setCrediting({ saleReturnId: null, amount: s.total })}>
              Emitir nota de crédito
            </button>
          </Alert>
        </div>
      )}
      {s.void && (
        <div className="mb-4">
          <Alert>
            Anulada el {formatDateTime(s.void.at)} por {s.void.byName}
            {s.void.authorizedByName && `, autorizó ${s.void.authorizedByName}`}. Motivo: {s.void.reason}
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        {s.kind === 'account_payment' ? (
          <Card className="space-y-2 p-5">
            <h2 className="font-semibold">Cobro de cuenta corriente</h2>
            <p className="text-sm text-slate-600">
              Pago de{' '}
              {s.customer ? (
                <Link to="/app/clientes/$id" params={{ id: s.customer.id }} className="font-semibold text-brand-700 hover:underline">
                  {s.customer.name}
                </Link>
              ) : (
                'un cliente'
              )}{' '}
              por {formatArs(s.total)}: bajó su deuda. No se factura: la factura corresponde a la venta en la que se llevó la mercadería.
            </p>
          </Card>
        ) : s.giftCard ? (
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-semibold">
                <Gift className="mr-1 inline size-4" aria-hidden /> Gift card <span className="font-mono">{formatGiftCardCode(s.giftCard.code)}</span>
              </h2>
              <Badge tone={GIFT_CARD_STATES[s.giftCard.state].tone}>{GIFT_CARD_STATES[s.giftCard.state].label}</Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Monto</dt><dd className="font-semibold">{formatArs(s.giftCard.amount)}</dd></div>
              <div><dt className="text-slate-500">Saldo</dt><dd className="font-semibold">{formatArs(s.giftCard.balance)}</dd></div>
              <div><dt className="text-slate-500">Vence</dt><dd>{formatExpiry(s.giftCard.expiresOn)}</dd></div>
              <div><dt className="text-slate-500">Para / De</dt><dd>{[s.giftCard.recipientName, s.giftCard.fromName].filter(Boolean).join(' / ') || '—'}</dd></div>
            </dl>
            {can('sales.read_all') && (
              <Button variant="secondary" size="sm" onClick={() => setShowingCard(true)}>
                Ver usos
              </Button>
            )}
          </Card>
        ) : (
        <Card>
          <Table
            head={
              <>
                <Th>Artículo</Th>
                <Th className="text-right">Cantidad</Th>
                <Th className="text-right">Precio</Th>
                <Th className="text-right">Desc.</Th>
                <Th className="text-right">Importe</Th>
                <Th className="text-right">Devuelto</Th>
              </>
            }
          >
            {s.lines.map((l) => (
              <tr key={l.id}>
                <Td className="font-medium">{l.description}</Td>
                <Td className="text-right">{formatQty(l.quantity, l.saleMode)}</Td>
                <Td className="text-right">{formatArs(l.unitPrice)}</Td>
                <Td className="text-right">
                  {l.discountPercent === '0.00' ? (l.promotionName ? '' : '—') : `${l.discountPercent.replace('.', ',')} %`}
                  {l.promotionName && <span className="block text-xs font-semibold text-emerald-700">{l.promotionName} −{formatArs(l.promotionDiscount)}</span>}
                </Td>
                <Td className="text-right font-semibold">{formatArs(l.total)}</Td>
                <Td className="text-right">{dec(l.returnedQuantity).gt(0) ? formatQty(l.returnedQuantity, l.saleMode) : '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        )}
        <Card className="h-fit space-y-2 p-5 text-sm">
          {s.discountTotal !== '0.00' && (
            <>
              <Line label="Subtotal" value={formatArs(s.subtotal)} />
              <Line label={`Descuentos${s.discountAuthorizedBy ? ` (autorizó ${s.discountAuthorizedBy})` : ''}`} value={`−${formatArs(s.discountTotal)}`} />
            </>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatArs(s.total)}</span>
          </div>
          {s.payments.map((p, i) => (
            <Line key={i} label={`${p.name}${p.reference ? ` · ${p.reference}` : ''}`} value={formatArs(p.amount)} />
          ))}
          {s.changeGiven !== '0.00' && <Line label="Vuelto entregado" value={formatArs(s.changeGiven)} />}
          {s.payments.filter((p) => p.payerName || p.payerPhone).map((p, i) => (
            <p key={`payer-${i}`} className="text-xs text-slate-500">
              Pagó {[p.payerName, p.payerPhone].filter(Boolean).join(' · ')} ({p.name})
            </p>
          ))}
          {invoices.data?.filter((i) => i.status === 'authorized').map((i) => (
            <div key={i.id} className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
              <span>
                {invoiceNumber(i)}
                <span className="block text-xs text-slate-500">CAE {i.cae}{i.environment === 'homologacion' ? ' · prueba' : ''}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => setPrintingInvoice(i)}>
                Imprimir
              </Button>
            </div>
          ))}
        </Card>
      </div>
      {s.returns.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold">Devoluciones</h2>
          <Table
            head={
              <>
                <Th>N°</Th>
                <Th>Fecha</Th>
                <Th>Motivo</Th>
                <Th>Reintegro</Th>
                <Th>Registró</Th>
                <Th className="text-right">Importe</Th>
              </>
            }
          >
            {s.returns.map((r) => (
              <tr key={r.id}>
                <Td>{r.number}</Td>
                <Td>{formatDateTime(r.createdAt)}</Td>
                <Td>
                  {r.reason}
                  {r.exchangeSale && (
                    <span className="block text-xs">
                      Se cambió por la{' '}
                      <Link to="/app/ventas/$id" params={{ id: r.exchangeSale.id }} className="font-semibold text-brand-700 underline">
                        venta N° {r.exchangeSale.number}
                      </Link>
                    </span>
                  )}
                </Td>
                <Td>{refundLabel(r)}</Td>
                <Td>
                  {r.userName}
                  {r.authorizedByName && <span className="block text-xs text-slate-500">Autorizó {r.authorizedByName}</span>}
                </Td>
                <Td className="text-right font-semibold">
                  {formatArs(r.total)}
                  {invoice && noteFor(r.id)?.status !== 'authorized' && (
                    <button type="button" className="block w-full text-right text-xs font-semibold text-brand-700 underline" onClick={() => setCrediting({ saleReturnId: r.id, amount: r.total })}>
                      Emitir nota de crédito
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {voiding && <VoidDialog sale={s} onClose={() => setVoiding(false)} />}
      {returning && <ReturnDialog sale={s} onClose={() => setReturning(false)} />}
      {exchanging && <ExchangeDialog sale={s} onClose={() => setExchanging(false)} />}
      {showingCard && s.giftCard && <GiftCardDetailDialog code={s.giftCard.code} onClose={() => setShowingCard(false)} />}
      {printing && tenant.data && <PrintTicket sale={s} exchange={printing === 'exchange'} tenant={tenant.data} onDone={() => setPrinting(null)} />}
      {invoicing && <InvoiceDialog sale={s} taxCondition={tenant.data?.taxCondition} canConfigure={can('fiscal.manage')} onClose={() => setInvoicing(false)} />}
      {crediting && invoice && (
        <CreditNoteDialog invoice={invoice} saleReturnId={crediting.saleReturnId} amount={crediting.amount} existing={noteFor(crediting.saleReturnId)} onClose={() => setCrediting(null)} />
      )}
      {printingInvoice && <InvoicePrint invoice={printingInvoice} onClose={() => setPrintingInvoice(null)} />}
    </>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3">
    <span className="text-slate-600">{label}</span>
    <span>{value}</span>
  </div>
);

function VoidDialog({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const { mutation, error, setError, dialog, waitingPin } = useAuthorized(
    (authorization) => http.post<SaleDto>(`/sales/${sale.id}/void`, { reason: reason.trim(), authorization }),
    async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast(`Venta N° ${sale.number} anulada`);
      onClose();
    },
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setError('Escribí el motivo');
    setError(null);
    mutation.mutate(null);
  }
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title={`Anular la venta N° ${sale.number}`} description="El stock vuelve al depósito y el efectivo sale de la caja. Solo se puede anular dentro del mismo turno.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Motivo">{(p) => <Input {...p} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={mutation.isPending && !waitingPin}>
              Anular venta
            </Button>
          </div>
        </form>
      </Dialog>
      {dialog}
    </>
  );
}

function ReturnDialog({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const registers = useQuery(registersQuery);
  const methods = useQuery(paymentMethodsQuery);
  const openRegisters = (registers.data ?? []).filter((r) => r.openShift);
  const [registerId, setRegisterId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [reason, setReason] = useState('');
  const [clientUuid] = useState(newClientUuid);
  const pending = sale.lines.filter((l) => dec(l.quantity).gt(l.returnedQuantity));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const register = registerId || (openRegisters.find((r) => r.id === sale.registerId) ?? openRegisters[0])?.id || '';
  const activeMethods = (methods.data ?? []).filter((m) => m.active);
  // Se reintegra por donde se cobró (el medio con el que más se pagó): una venta con tarjeta no se devuelve del cajón.
  const paidWith = [...sale.payments].sort((a, b) => dec(b.amount).cmp(a.amount)).find((p) => activeMethods.some((m) => m.id === p.paymentMethodId));
  const method = methodId || paidWith?.paymentMethodId || activeMethods.find((m) => m.kind === 'cash')?.id || activeMethods[0]?.id || '';

  const lines = pending
    .map((l) => {
      const q = parseDecimalInput(qty[l.id] ?? '');
      const remaining = dec(l.quantity).minus(l.returnedQuantity);
      const valid = /^\d+(\.\d{1,3})?$/.test(q) && dec(q).gt(0) && dec(q).lte(remaining);
      const returnedAmount = sumMoney(sale.returns.flatMap((r) => r.lines.filter((x) => x.saleLineId === l.id).map((x) => x.amount)));
      const amount = valid ? (dec(q).eq(remaining) ? roundMoney(dec(l.total).minus(returnedAmount)) : proportionalAmount(l.total, q, l.quantity)) : '0.00';
      return { line: l, q, valid, typed: (qty[l.id] ?? '').trim() !== '', amount, remaining };
    })
    .filter((x) => x.typed);
  const total = sumMoney(lines.map((l) => l.amount));
  // Lo pagado con gift card vuelve a la tarjeta (ADR 0015); solo el resto sale por el medio elegido.
  const giftPaid = sumMoney(sale.payments.filter((p) => p.kind === 'gift_card').map((p) => p.amount));
  const giftPending = dec(giftPaid).minus(sumMoney(sale.returns.map((r) => r.giftCardAmount)));
  const toCard = giftPending.gt(0) ? roundMoney(dec(total).lt(giftPending) ? dec(total) : giftPending) : '0.00';
  // Lo fiado baja la deuda del cliente (ADR 0016).
  const accountPaid = sumMoney(sale.payments.filter((p) => p.kind === 'account').map((p) => p.amount));
  const accountPending = dec(accountPaid).minus(sumMoney(sale.returns.map((r) => r.accountAmount)));
  const afterCard = dec(total).minus(toCard);
  const toAccount = accountPending.gt(0) ? roundMoney(afterCard.lt(accountPending) ? afterCard : accountPending) : '0.00';
  const rest = roundMoney(afterCard.minus(toAccount));

  const { mutation, error, setError, dialog, waitingPin } = useAuthorized(
    (authorization) =>
      http.post<SaleDto>(`/sales/${sale.id}/returns`, {
        clientUuid,
        registerId: register,
        reason: reason.trim(),
        paymentMethodId: method,
        lines: lines.map((l) => ({ saleLineId: l.line.id, quantity: l.q, restock: restock[l.line.id] ?? true })),
        authorization,
      }),
    async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(`Devolución registrada: ${formatArs(total)}`);
      onClose();
    },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return setError('Indicá cuánto se devuelve de cada artículo');
    if (lines.some((l) => !l.valid)) return setError('Revisá las cantidades: no pueden superar lo que queda por devolver');
    if (!reason.trim()) return setError('Escribí el motivo');
    if (!register) return setError('Para devolver tiene que haber una caja abierta');
    setError(null);
    mutation.mutate(null);
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title={`Devolución de la venta N° ${sale.number}`} wide>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2">Artículo</th>
                  <th className="py-2 text-right">Queda</th>
                  <th className="w-28 py-2 pl-3">Devuelve</th>
                  <th className="py-2 pl-3">Vuelve al stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-medium">{l.description}</td>
                    <td className="py-2 text-right">{formatQty(roundQty(dec(l.quantity).minus(l.returnedQuantity)), l.saleMode)}</td>
                    <td className="py-2 pl-3">
                      <Input aria-label={`Cantidad que devuelve de ${l.description}`} inputMode="decimal" className="h-9 text-right" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                    </td>
                    <td className="py-2 pl-3">
                      <input
                        type="checkbox"
                        aria-label={`${l.description} vuelve al stock`}
                        className="size-4"
                        checked={restock[l.id] ?? true}
                        onChange={(e) => setRestock({ ...restock, [l.id]: e.target.checked })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Motivo">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />}</Field>
            <Field label={dec(toCard).gt(0) || dec(toAccount).gt(0) ? 'El resto se reintegra en' : 'Se reintegra en'}>
              {(p) => (
                <Select {...p} value={method} onChange={(e) => setMethodId(e.target.value)}>
                  {activeMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Caja">
              {(p) => (
                <Select {...p} value={register} onChange={(e) => setRegisterId(e.target.value)}>
                  {openRegisters.length === 0 && <option value="">{registers.isLoading ? 'Cargando…' : 'No hay cajas abiertas'}</option>}
                  {openRegisters.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.branchName} · {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>
              <span className="text-lg">
                A devolver: <span className="font-bold">{formatArs(total)}</span>
              </span>
              {(dec(toCard).gt(0) || dec(toAccount).gt(0)) && (
                <span className="block text-sm text-slate-600">
                  {[dec(toCard).gt(0) && `${formatArs(toCard)} vuelven a la gift card`, dec(toAccount).gt(0) && `${formatArs(toAccount)} bajan la deuda de ${sale.customer?.name ?? 'la cuenta'}`, dec(rest).gt(0) && `${formatArs(rest)} con el medio elegido`]
                    .filter(Boolean)
                    .join(', ')}
                  .
                </span>
              )}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Volver
              </Button>
              <Button type="submit" loading={mutation.isPending && !waitingPin}>
                Registrar devolución
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
      {dialog}
    </>
  );
}

const roundQty = (v: ReturnType<typeof dec>) => v.toFixed(3);

/** Por dónde salió el reintegro: gift card, cuenta corriente y el medio elegido. */
function refundLabel(r: SaleDto['returns'][number]) {
  const parts = [dec(r.giftCardAmount).gt(0) && `Gift card ${formatArs(r.giftCardAmount)}`, dec(r.accountAmount).gt(0) && `Cuenta corriente ${formatArs(r.accountAmount)}`].filter(Boolean) as string[];
  const rest = dec(r.total).minus(r.giftCardAmount).minus(r.accountAmount);
  if (rest.gt(0) || parts.length === 0) parts.push(parts.length ? `${r.paymentMethodName} ${formatArs(rest.toFixed(2))}` : r.paymentMethodName);
  return parts.join(' · ');
}
