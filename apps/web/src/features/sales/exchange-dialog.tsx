import { createExchangeSchema, type ItemDto, type SaleDto, variantDisplayName } from '@gc/contracts';
import { dec, formatArs, proportionalAmount, roundMoney, saleLine, sumMoney } from '@gc/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { newClientUuid } from '@/features/catalog/queries';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { http } from '@/lib/api';
import { formatQty, parseDecimalInput } from '@/lib/format';
import { paymentMethodsQuery, registersQuery } from './queries';
import { useAuthorized } from './use-authorized';

const QTY = /^\d+(\.\d{1,3})?$/;

/**
 * Cambio de talle o de artículo (ADR 0014): lo que devuelve queda como crédito y paga lo que se
 * lleva. Si lo nuevo cuesta más, se cobra la diferencia; por menos no se puede: eso es una devolución.
 */
export function ExchangeDialog({ sale, onClose }: { sale: SaleDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const registers = useQuery(registersQuery);
  const methods = useQuery(paymentMethodsQuery);
  const openRegisters = (registers.data ?? []).filter((r) => r.openShift);
  const activeMethods = (methods.data ?? []).filter((m) => m.active);
  const [clientUuid] = useState(newClientUuid);
  const [back, setBack] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Array<{ item: ItemDto; quantity: string }>>([]);
  const [reason, setReason] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const register = registerId || (openRegisters.find((r) => r.id === sale.registerId) ?? openRegisters[0])?.id || '';
  const method = activeMethods.find((m) => m.id === methodId) ?? activeMethods.find((m) => m.kind === 'cash') ?? activeMethods[0];

  // Lo que devuelve, con el mismo cálculo que la devolución: la última unidad se lleva lo que quede.
  const pending = sale.lines.filter((l) => dec(l.quantity).gt(l.returnedQuantity));
  const returning = pending
    .map((l) => {
      const q = parseDecimalInput(back[l.id] ?? '');
      const remaining = dec(l.quantity).minus(l.returnedQuantity);
      const valid = QTY.test(q) && dec(q).gt(0) && dec(q).lte(remaining);
      const returnedAmount = sumMoney(sale.returns.flatMap((r) => r.lines.filter((x) => x.saleLineId === l.id).map((x) => x.amount)));
      const amount = valid ? (dec(q).eq(remaining) ? roundMoney(dec(l.total).minus(returnedAmount)) : proportionalAmount(l.total, q, l.quantity)) : '0.00';
      return { line: l, q, valid, typed: (back[l.id] ?? '').trim() !== '', amount };
    })
    .filter((x) => x.typed);
  const credit = sumMoney(returning.map((r) => r.amount));
  const taking = items.map((i) => {
    const q = parseDecimalInput(i.quantity);
    const valid = QTY.test(q) && dec(q).gt(0);
    return { ...i, q, valid, total: valid ? saleLine(q, i.item.price, '0').total : '0.00' };
  });
  const total = sumMoney(taking.map((t) => t.total));
  const difference = dec(total).minus(credit);
  const toPay = difference.gt(0) ? roundMoney(difference) : '0.00';
  const isCash = method?.kind === 'cash';
  const paid = isCash && received.trim() ? parseDecimalInput(received) : toPay;
  const change = isCash && /^\d+(\.\d{1,2})?$/.test(paid) && dec(paid).gt(toPay) ? roundMoney(dec(paid).minus(toPay)) : '0.00';

  const { mutation, error, setError, dialog, waitingPin } = useAuthorized(
    (authorization) =>
      http.post<SaleDto>(`/sales/${sale.id}/exchanges`, {
        clientUuid,
        registerId: register,
        reason: reason.trim(),
        returnLines: returning.map((r) => ({ saleLineId: r.line.id, quantity: r.q, restock: restock[r.line.id] ?? true })),
        lines: taking.map((t) => ({ variantId: t.item.variantId, quantity: t.q, discountPercent: '0' })),
        payments: dec(toPay).gt(0) && method ? [{ paymentMethodId: method.id, amount: paid, reference: reference.trim() || null }] : [],
        expectedTotal: total,
        authorization,
      }),
    async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast(`Cambio registrado: venta N° ${created.number}`);
      onClose();
      void navigate({ to: '/app/ventas/$id', params: { id: created.id } });
    },
  );

  function add(item: ItemDto, factor: string) {
    setItems((list) => {
      const i = list.findIndex((x) => x.item.variantId === item.variantId);
      if (i === -1) return [...list, { item, quantity: dec(factor).toFixed(item.saleMode === 'unit' ? 0 : 3) }];
      return list.map((x, j) => (j === i ? { ...x, quantity: dec(parseDecimalInput(x.quantity) || '0').plus(factor).toString() } : x));
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (returning.length === 0) return setError('Indicá qué devuelve el cliente');
    if (returning.some((r) => !r.valid)) return setError('Revisá lo que devuelve: no puede superar lo que queda de cada artículo');
    if (taking.length === 0) return setError('Agregá lo que se lleva');
    if (taking.some((t) => !t.valid)) return setError('Revisá las cantidades de lo que se lleva');
    if (difference.lt(0)) return setError(`Lo que se lleva suma ${formatArs(dec(credit).minus(total).toFixed(2))} menos que lo que devuelve. Agregá artículos o registrá una devolución.`);
    if (!reason.trim()) return setError('Escribí el motivo del cambio');
    if (!register) return setError('Para hacer un cambio tiene que haber una caja abierta');
    if (isCash && dec(toPay).gt(0) && (!/^\d+(\.\d{1,2})?$/.test(paid) || dec(paid).lt(toPay))) return setError(`Falta cobrar ${formatArs(toPay)}`);
    if (method?.requiresReference && dec(toPay).gt(0) && !reference.trim()) return setError(`Cargá el número de operación de ${method.name}`);
    const body = {
      clientUuid, registerId: register, reason,
      returnLines: returning.map((r) => ({ saleLineId: r.line.id, quantity: r.q, restock: true })),
      lines: taking.map((t) => ({ variantId: t.item.variantId, quantity: t.q, discountPercent: '0' })),
      payments: [], expectedTotal: total,
    };
    const parsed = createExchangeSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
    setError(null);
    mutation.mutate(null);
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()} title={`Cambio de la venta N° ${sale.number}`} description="Lo que devuelve queda como crédito para lo que se lleva." wide>
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Alert>{error}</Alert>}
          <section>
            <h3 className="mb-2 text-sm font-semibold">1. Qué devuelve</h3>
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
                      <td className="py-2 text-right">{formatQty(dec(l.quantity).minus(l.returnedQuantity).toFixed(3), l.saleMode)}</td>
                      <td className="py-2 pl-3">
                        <Input aria-label={`Cantidad que devuelve de ${l.description}`} inputMode="decimal" className="h-9 text-right" value={back[l.id] ?? ''} onChange={(e) => setBack({ ...back, [l.id]: e.target.value })} />
                      </td>
                      <td className="py-2 pl-3">
                        <input type="checkbox" aria-label={`${l.description} vuelve al stock`} className="size-4" checked={restock[l.id] ?? true} onChange={(e) => setRestock({ ...restock, [l.id]: e.target.checked })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">2. Qué se lleva</h3>
            <ProductPicker onlyStock={false} onPick={add} label="Escaneá o buscá el artículo que se lleva" />
            {taking.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Artículos que se lleva">
                {taking.map((t, i) => (
                  <li key={t.item.variantId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">{variantDisplayName(t.item.name, t.item.variantLabel)}</span>
                    <Input
                      aria-label={`Cantidad que se lleva de ${variantDisplayName(t.item.name, t.item.variantLabel)}`}
                      inputMode="decimal"
                      className="h-9 w-20 text-right"
                      value={t.quantity}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                    />
                    <span className="w-28 text-right font-semibold">{formatArs(t.total)}</span>
                    <Button variant="ghost" size="sm" aria-label={`Quitar ${t.item.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-1 rounded-lg bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span>Crédito por lo que devuelve</span><span>{formatArs(credit)}</span></div>
            <div className="flex justify-between"><span>Lo que se lleva</span><span>{formatArs(total)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
              <span>{difference.lt(0) ? 'Falta agregar' : 'A cobrar'}</span>
              <span>{formatArs(difference.abs().toFixed(2))}</span>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Motivo">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={180} placeholder="Ej.: le quedaba chico" />}</Field>
            {dec(toPay).gt(0) && (
              <Field label="Cobra la diferencia con">
                {(p) => (
                  <Select {...p} value={method?.id ?? ''} onChange={(e) => (setMethodId(e.target.value), setReceived(''), setReference(''))}>
                    {activeMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {dec(toPay).gt(0) && isCash && (
              <Field label="Recibido en efectivo" hint={dec(change).gt(0) ? `Vuelto ${formatArs(change)}` : undefined}>
                {(p) => <Input {...p} inputMode="decimal" placeholder={toPay} value={received} onChange={(e) => setReceived(e.target.value)} />}
              </Field>
            )}
            {dec(toPay).gt(0) && method?.requiresReference && (
              <Field label="N° de operación">{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
            )}
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

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Volver
            </Button>
            <Button type="submit" loading={mutation.isPending || waitingPin}>
              Registrar cambio
            </Button>
          </div>
        </form>
      </Dialog>
      {dialog}
    </>
  );
}
