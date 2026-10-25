import { createSaleSchema, type PaymentMethodDto, type PermissionCode, type ProductDto, type RegisterDto, type SaleDto } from '@gc/contracts';
import { dec, formatArs, roundMoney, saleLine, sumMoney } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid, tenantQuery } from '@/features/catalog/queries';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatQty, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PinDialog } from './pin-dialog';
import { type Authorization, needsAuthorization, paymentMethodsQuery, registersQuery, rememberedRegister, rememberRegister } from './queries';
import { PrintTicket } from './ticket';

interface CartLine {
  product: ProductDto;
  quantity: string;
  discountPercent: string;
}

interface Cart {
  clientUuid: string;
  lines: CartLine[];
}

interface PaymentRow {
  paymentMethodId: string;
  amount: string;
  reference: string;
}

const emptyCart = (): Cart => ({ clientUuid: newClientUuid(), lines: [] });

/**
 * La venta en curso se guarda en este equipo mientras se arma: si se corta la luz o se recarga
 * la página, se recupera, con el mismo identificador para que un reintento no la duplique.
 */
function useStoredCart(registerId: string | null) {
  const key = registerId ? `gc.cart.${registerId}` : null;
  const [cart, setCart] = useState<Cart>(emptyCart);
  useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      setCart(raw ? (JSON.parse(raw) as Cart) : emptyCart());
    } catch {
      setCart(emptyCart());
    }
  }, [key]);
  const update = useCallback(
    (next: Cart | ((c: Cart) => Cart)) =>
      setCart((current) => {
        const value = typeof next === 'function' ? next(current) : next;
        try {
          if (key) localStorage.setItem(key, JSON.stringify(value));
        } catch {
          // sin almacenamiento local la venta sigue en memoria
        }
        return value;
      }),
    [key],
  );
  return [cart, update] as const;
}

const isPositive = (v: string) => /^\d+(\.\d+)?$/.test(v) && dec(v).gt(0);

export function PosPage() {
  const can = useCan();
  const allowed = can('sales.create');
  const registers = useQuery({ ...registersQuery, enabled: allowed });
  const [registerId, setRegisterId] = useState<string | null>(rememberedRegister());
  const active = (registers.data ?? []).filter((r) => r.status === 'active');
  const register = active.find((r) => r.id === registerId) ?? (active.length === 1 ? active[0] : undefined);

  if (!allowed) return <Forbidden />;
  if (registers.isLoading) return <Spinner />;
  if (registers.error) return <Alert>{errorMessage(registers.error)}</Alert>;

  return (
    <>
      <PageHeader
        title="Vender"
        description={register ? `${register.branchName} · ${register.name}` : 'Elegí en qué caja estás cobrando.'}
        actions={
          active.length > 1 ? (
            <Select
              aria-label="Caja"
              value={register?.id ?? ''}
              onChange={(e) => (setRegisterId(e.target.value), rememberRegister(e.target.value))}
              className="w-56"
            >
              <option value="" disabled>
                Elegí la caja
              </option>
              {active.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.branchName} · {r.name}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      {active.length === 0 && <EmptyState>No hay cajas activas en tus sucursales.</EmptyState>}
      {register && (register.openShift ? <Counter key={register.id} register={register} /> : <ClosedRegister register={register} />)}
    </>
  );
}

function ClosedRegister({ register }: { register: RegisterDto }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const open = useMutation({
    mutationFn: () => http.post('/shifts', { registerId: register.id, openingFloat: parseDecimalInput(amount || '0') }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registers'] }),
  });
  return (
    <Card className="mx-auto max-w-md p-6">
      <h2 className="text-lg font-semibold">{register.name} está cerrada</h2>
      {can('cash.open') ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            open.mutate();
          }}
          noValidate
        >
          {open.error && <Alert>{errorMessage(open.error)}</Alert>}
          <Field label="Efectivo con el que arranca la caja" hint="El cambio que dejás en el cajón al abrir.">
            {(p) => <Input {...p} inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Button type="submit" loading={open.isPending}>
            Abrir caja
          </Button>
        </form>
      ) : (
        <p className="mt-2 text-sm text-slate-600">Para vender, un encargado tiene que abrir la caja.</p>
      )}
    </Card>
  );
}

function Counter({ register }: { register: RegisterDto }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const toast = useToast();
  const tenant = useQuery(tenantQuery);
  const methods = useQuery(paymentMethodsQuery);
  const [cart, setCart] = useStoredCart(register.id);
  const [checkout, setCheckout] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<SaleDto | null>(null);
  const [printing, setPrinting] = useState<SaleDto | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  const focusScanner = useCallback(() => window.setTimeout(() => scanner.current?.focus(), 0), []);

  const computed = useMemo(
    () =>
      cart.lines.map((l) => {
        const valid = isPositive(l.quantity) && /^\d{1,3}(\.\d{1,2})?$/.test(l.discountPercent) && dec(l.discountPercent).lte(100);
        return { ...l, valid, amounts: valid ? saleLine(l.quantity, l.product.price, l.discountPercent) : { gross: '0.00', discount: '0.00', total: '0.00' } };
      }),
    [cart.lines],
  );
  const total = sumMoney(computed.map((l) => l.amounts.total));
  const discount = sumMoney(computed.map((l) => l.amounts.discount));
  const allValid = computed.length > 0 && computed.every((l) => l.valid);

  function add(product: ProductDto, factor: string) {
    setNotice(null);
    setLastSale(null);
    setCart((c) => {
      const i = c.lines.findIndex((l) => l.product.variantId === product.variantId);
      if (i === -1) return { ...c, lines: [...c.lines, { product, quantity: dec(factor).toFixed(3), discountPercent: '0' }] };
      const lines = [...c.lines];
      lines[i] = { ...lines[i]!, product, quantity: dec(isPositive(lines[i]!.quantity) ? lines[i]!.quantity : '0').plus(factor).toFixed(3) };
      return { ...c, lines };
    });
    focusScanner();
  }
  const setLine = (i: number, patch: Partial<CartLine>) => setCart((c) => ({ ...c, lines: c.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const remove = (i: number) => (setCart((c) => ({ ...c, lines: c.lines.filter((_, j) => j !== i) })), focusScanner());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2' && allValid && !checkout) {
        e.preventDefault();
        setCheckout(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allValid, checkout]);

  function done(sale: SaleDto) {
    setCheckout(false);
    setLastSale(sale);
    setCart(emptyCart());
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
    toast(`Venta N° ${sale.number} registrada`);
    focusScanner();
  }

  /** El servidor recalculó con los precios vigentes: se actualizan en la venta para revisarlos. */
  function pricesChanged(err: ApiRequestError) {
    const prices = (err.details as { prices?: Array<{ variantId: string; unitPrice: string }> } | undefined)?.prices ?? [];
    setCart((c) => ({
      ...c,
      lines: c.lines.map((l) => {
        const p = prices.find((x) => x.variantId === l.product.variantId);
        return p ? { ...l, product: { ...l.product, price: p.unitPrice } } : l;
      }),
    }));
    setCheckout(false);
    setNotice('Cambió el precio de algún artículo mientras armabas la venta. Ya está actualizado: revisá el total y cobrá de nuevo.');
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <ProductPicker inputRef={scanner} autoFocus onlyStock={false} onPick={add} label="Escaneá o buscá un artículo" />
        {notice && <Alert kind="info">{notice}</Alert>}
        <Card>
          {cart.lines.length === 0 ? (
            <EmptyState>{lastSale ? `Venta N° ${lastSale.number} cobrada. Escaneá el primer artículo de la próxima.` : 'Escaneá el primer artículo para empezar la venta.'}</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-100/70 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Artículo</th>
                    <th className="w-28 px-2 py-3">Cantidad</th>
                    <th className="px-2 py-3 text-right">Precio</th>
                    <th className="w-24 px-2 py-3">Desc. %</th>
                    <th className="px-4 py-3 text-right">Importe</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {computed.map((l, i) => (
                    <tr key={l.product.variantId}>
                      <td className="px-4 py-2 font-medium">{l.product.name}</td>
                      <td className="px-2 py-2">
                        <DecimalCell
                          label={`Cantidad de ${l.product.name}`}
                          value={l.quantity}
                          invalid={!isPositive(l.quantity)}
                          onChange={(v) => setLine(i, { quantity: v })}
                          onEnter={focusScanner}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">{formatArs(l.product.price)}</td>
                      <td className="px-2 py-2">
                        <DecimalCell
                          label={`Descuento de ${l.product.name}`}
                          value={l.discountPercent}
                          invalid={!l.valid && isPositive(l.quantity)}
                          onChange={(v) => setLine(i, { discountPercent: v || '0' })}
                          onEnter={focusScanner}
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-semibold">{formatArs(l.amounts.total)}</td>
                      <td className="px-2 py-2">
                        <button type="button" className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`Quitar ${l.product.name}`} onClick={() => remove(i)}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card className="h-fit space-y-4 p-5 xl:sticky xl:top-6">
        <div className="flex items-baseline justify-between text-sm text-slate-600">
          <span>{cart.lines.length === 1 ? '1 artículo' : `${cart.lines.length} artículos`}</span>
          {dec(discount).gt(0) && <span>Descuentos −{formatArs(discount)}</span>}
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">Total</span>
          <span className="text-4xl font-bold tracking-tight" aria-label="Total de la venta">
            {formatArs(total)}
          </span>
        </div>
        <Button className="h-14 w-full text-lg" disabled={!allValid} onClick={() => setCheckout(true)}>
          Cobrar (F2)
        </Button>
        {cart.lines.length > 0 && (
          <Button variant="ghost" className="w-full" onClick={() => (setCart(emptyCart()), focusScanner())}>
            Cancelar la venta
          </Button>
        )}
        {lastSale && cart.lines.length === 0 && (
          <div className="space-y-2 border-t border-slate-200 pt-4 text-sm">
            <div className="flex justify-between">
              <span>Venta N° {lastSale.number}</span>
              <span className="font-semibold">{formatArs(lastSale.total)}</span>
            </div>
            {lastSale.changeGiven !== '0.00' && (
              <div className="flex justify-between text-base">
                <span>Vuelto</span>
                <span className="font-bold">{formatArs(lastSale.changeGiven)}</span>
              </div>
            )}
            <Button variant="secondary" className="w-full" disabled={!tenant.data} onClick={() => setPrinting(lastSale)}>
              <Printer className="size-4" /> Imprimir ticket
            </Button>
          </div>
        )}
        {can('sales.read_own', 'sales.read_all') && (
          <Link to="/app/ventas" className="block text-center text-sm text-brand-700 hover:underline">
            Ver ventas
          </Link>
        )}
      </Card>
      {checkout && methods.data && (
        <CheckoutDialog
          registerId={register.id}
          cart={cart}
          total={total}
          methods={methods.data.filter((m) => m.active)}
          onClose={() => (setCheckout(false), focusScanner())}
          onDone={done}
          onPriceChanged={pricesChanged}
        />
      )}
      {printing && tenant.data && <PrintTicket sale={printing} tenant={tenant.data} onDone={() => (setPrinting(null), focusScanner())} />}
    </div>
  );
}

/** Campo numérico de la grilla: se tipea con coma o punto y se guarda como texto decimal. */
function DecimalCell({ label, value, invalid, onChange, onEnter }: { label: string; value: string; invalid: boolean; onChange: (v: string) => void; onEnter: () => void }) {
  const [text, setText] = useState(toInputDecimal(value));
  useEffect(() => setText(toInputDecimal(value)), [value]);
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      className="h-9 text-right"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(parseDecimalInput(text))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onChange(parseDecimalInput(text));
          onEnter();
        }
      }}
    />
  );
}

function CheckoutDialog({
  registerId,
  cart,
  total,
  methods,
  onClose,
  onDone,
  onPriceChanged,
}: {
  registerId: string;
  cart: Cart;
  total: string;
  methods: PaymentMethodDto[];
  onClose: () => void;
  onDone: (sale: SaleDto) => void;
  onPriceChanged: (err: ApiRequestError) => void;
}) {
  const cash = methods.find((m) => m.kind === 'cash') ?? methods[0];
  const [rows, setRows] = useState<PaymentRow[]>([{ paymentMethodId: cash?.id ?? '', amount: '', reference: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<{ permission: PermissionCode; error: string | null } | null>(null);
  const byId = new Map(methods.map((m) => [m.id, m]));

  const amounts = rows.map((r, i) => (r.amount.trim() === '' && i === 0 && rows.length === 1 ? total : parseDecimalInput(r.amount)));
  const amountsValid = amounts.every((a) => /^\d+(\.\d{1,2})?$/.test(a));
  const paid = amountsValid ? sumMoney(amounts) : '0.00';
  const missing = dec(total).minus(paid);
  const nonCash = amountsValid ? sumMoney(amounts.filter((_, i) => byId.get(rows[i]!.paymentMethodId)?.kind !== 'cash')) : '0.00';
  const change = missing.lt(0) ? roundMoney(missing.negated()) : '0.00';
  const ready = amountsValid && missing.lte(0) && dec(nonCash).lte(total);

  const confirm = useMutation({
    mutationFn: (authorization: Authorization) => {
      const body = createSaleSchema.parse({
        clientUuid: cart.clientUuid,
        registerId,
        lines: cart.lines.map((l) => ({ variantId: l.product.variantId, quantity: l.quantity, discountPercent: l.discountPercent })),
        payments: rows.map((r, i) => ({ paymentMethodId: r.paymentMethodId, amount: amounts[i]!, reference: r.reference || null })).filter((p) => dec(p.amount).gt(0)),
        expectedTotal: total,
        authorization,
      });
      return http.post<SaleDto>('/sales', body);
    },
    onSuccess: onDone,
    onError: (err) => {
      const permission = needsAuthorization(err);
      if (permission) return setPin({ permission, error: err instanceof ApiRequestError && err.code === 'AUTHORIZATION_INVALID' ? err.message : null });
      if (err instanceof ApiRequestError && err.code === 'PRICE_CHANGED') return onPriceChanged(err);
      setPin(null);
      setError(err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR' ? Object.values(err.fieldErrors())[0] ?? err.message : errorMessage(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const missingRef = rows.find((r, i) => byId.get(r.paymentMethodId)?.requiresReference && !r.reference.trim() && dec(amounts[i]!).gt(0));
    if (missingRef) return setError(`Cargá el número de operación de ${byId.get(missingRef.paymentMethodId)!.name}`);
    setError(null);
    confirm.mutate(null);
  }
  const setRow = (i: number, patch: Partial<PaymentRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !confirm.isPending && onClose()} title="Cobrar" description={`Total ${formatArs(total)}`} wide>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          {rows.map((r, i) => {
            const method = byId.get(r.paymentMethodId);
            return (
              <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_10rem_1fr_auto]">
                <Field label={`Medio de pago ${i + 1}`}>
                  {(p) => (
                    <Select {...p} value={r.paymentMethodId} onChange={(e) => setRow(i, { paymentMethodId: e.target.value })}>
                      {methods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={`Importe ${i + 1}`}>
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      autoFocus={i === rows.length - 1}
                      placeholder={i === 0 && rows.length === 1 ? toInputDecimal(total) : ''}
                      value={r.amount}
                      onChange={(e) => setRow(i, { amount: e.target.value })}
                    />
                  )}
                </Field>
                {method?.requiresReference ? (
                  <Field label={`N° de operación ${i + 1}`}>{(p) => <Input {...p} value={r.reference} onChange={(e) => setRow(i, { reference: e.target.value })} />}</Field>
                ) : (
                  <div />
                )}
                {rows.length > 1 ? (
                  <Button variant="ghost" aria-label={`Quitar el pago ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : (
                  <div />
                )}
              </div>
            );
          })}
          <Button
            variant="secondary"
            size="sm"
            disabled={rows.length >= 10 || !missing.gt(0)}
            onClick={() => {
              const other = methods.find((m) => m.kind !== 'cash') ?? cash;
              setRows((rs) => [...rs, { paymentMethodId: other?.id ?? '', amount: toInputDecimal(roundMoney(missing)), reference: '' }]);
            }}
          >
            <Plus className="size-4" /> Pagar el resto con otro medio
          </Button>
          <div className="space-y-1 rounded-lg bg-slate-100 p-4 text-sm">
            <div className="flex justify-between">
              <span>Pagado</span>
              <span className="font-semibold">{formatArs(paid)}</span>
            </div>
            {missing.gt(0) ? (
              <div className="flex justify-between text-red-700">
                <span>Falta</span>
                <span className="font-semibold">{formatArs(roundMoney(missing))}</span>
              </div>
            ) : (
              <div className="flex justify-between text-lg">
                <span>Vuelto</span>
                <span className="font-bold">{formatArs(change)}</span>
              </div>
            )}
            {dec(nonCash).gt(total) && <p className="text-red-700">Con tarjeta, transferencia o QR no se da vuelto: el importe no puede superar el total.</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={confirm.isPending}>
              Volver
            </Button>
            <Button type="submit" className="min-w-40" loading={confirm.isPending && !pin} disabled={!ready}>
              Confirmar venta
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            {formatQty(String(cart.lines.length))} {cart.lines.length === 1 ? 'artículo' : 'artículos'} · Si se corta la conexión, volvé a confirmar: la venta no se duplica.
          </p>
        </form>
      </Dialog>
      <PinDialog
        permission={pin?.permission ?? null}
        error={pin?.error ?? null}
        loading={confirm.isPending}
        onAuthorize={(a) => confirm.mutate(a)}
        onCancel={() => setPin(null)}
      />
    </>
  );
}
