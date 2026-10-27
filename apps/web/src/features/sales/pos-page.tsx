import { createSaleSchema, type PaymentMethodDto, type PermissionCode, type ProductDto, type RegisterDto, type SaleDto } from '@gc/contracts';
import { dec, formatArs, roundMoney, saleLine, sumMoney } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Minus, Plus, Printer, Trash2, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { newClientUuid, tenantQuery } from '@/features/catalog/queries';
import { ProductPicker } from '@/features/stock/product-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { NumPad, useKeypadPreference } from '@/components/ui/numpad';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { formatQty, parseDecimalInput, toInputDecimal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PinDialog } from './pin-dialog';
import { type Authorization, needsAuthorization, paymentMethodsQuery, registersQuery, rememberedRegister, rememberRegister } from './queries';
import { PrintTicket } from './ticket';
import { InvoiceDialog } from '@/features/fiscal/invoice-dialog';

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
  payerName?: string;
  payerPhone?: string;
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

const UNIT: Record<string, string> = { weight: 'kg', length: 'm', volume: 'l' };
const isMeasured = (p: ProductDto) => p.saleMode !== 'unit';
const QUANTITY_RE = /^\d+(\.\d{1,3})?$/;
/** Medios en los que se pide, opcionalmente, quién paga. */
const PAYER_KINDS: string[] = ['transfer', 'qr'];
const DISCOUNT_RE = /^\d{1,3}(\.\d{1,2})?$/;

function Counter({ register }: { register: RegisterDto }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const toast = useToast();
  const tenant = useQuery(tenantQuery);
  const methods = useQuery(paymentMethodsQuery);
  const favorites = useQuery({ queryKey: ['products', 'favorites'], queryFn: () => http.get<ProductDto[]>('/products/favorites'), staleTime: 5 * 60_000 });
  const [cart, setCart] = useStoredCart(register.id);
  const [checkout, setCheckout] = useState(false);
  const [editing, setEditing] = useState<{ product: ProductDto; index: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<SaleDto | null>(null);
  const [printing, setPrinting] = useState<SaleDto | null>(null);
  const [invoicing, setInvoicing] = useState<SaleDto | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  const focusScanner = useCallback(() => window.setTimeout(() => scanner.current?.focus(), 0), []);

  const computed = useMemo(
    () =>
      cart.lines.map((l) => {
        const valid = isPositive(l.quantity) && DISCOUNT_RE.test(l.discountPercent) && dec(l.discountPercent).lte(100);
        return { ...l, valid, amounts: valid ? saleLine(l.quantity, l.product.price, l.discountPercent) : { gross: '0.00', discount: '0.00', total: '0.00' } };
      }),
    [cart.lines],
  );
  const total = sumMoney(computed.map((l) => l.amounts.total));
  const discount = sumMoney(computed.map((l) => l.amounts.discount));
  const allValid = computed.length > 0 && computed.every((l) => l.valid);

  function addQuantity(product: ProductDto, quantity: string) {
    setCart((c) => {
      const i = c.lines.findIndex((l) => l.product.variantId === product.variantId);
      if (i === -1) return { ...c, lines: [...c.lines, { product, quantity: dec(quantity).toFixed(3), discountPercent: '0' }] };
      const lines = [...c.lines];
      lines[i] = { ...lines[i]!, product, quantity: dec(isPositive(lines[i]!.quantity) ? lines[i]!.quantity : '0').plus(quantity).toFixed(3) };
      return { ...c, lines };
    });
  }
  /** Los artículos por peso o medida piden cuánto, salvo que el código ya traiga la cantidad. */
  function add(product: ProductDto, factor: string) {
    setNotice(null);
    setLastSale(null);
    if (isMeasured(product) && dec(factor).eq(1)) return setEditing({ product, index: null });
    addQuantity(product, factor);
    focusScanner();
  }
  const setLine = (i: number, patch: Partial<CartLine>) => setCart((c) => ({ ...c, lines: c.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const remove = (i: number) => (setCart((c) => ({ ...c, lines: c.lines.filter((_, j) => j !== i) })), focusScanner());
  const step = (i: number, delta: number) => {
    const next = dec(cart.lines[i]!.quantity).plus(delta);
    if (next.gt(0)) setLine(i, { quantity: next.toFixed(3) });
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2' && allValid && !checkout && !editing) {
        e.preventDefault();
        setCheckout(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allValid, checkout, editing]);

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

  const editingLine = editing?.index != null ? cart.lines[editing.index] : undefined;
  const existing = editing && editing.index === null ? cart.lines.find((l) => l.product.variantId === editing.product.variantId) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
      <div className="space-y-4">
        <ProductPicker inputRef={scanner} autoFocus onlyStock={false} onPick={add} label="Escaneá o buscá un artículo" inputClassName="h-14 text-lg" />
        {notice && <Alert kind="info">{notice}</Alert>}
        {favorites.data && favorites.data.length > 0 ? (
          <section aria-label="Más vendidos">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Más vendidos</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {favorites.data.map((p) => (
                <button
                  key={p.variantId}
                  type="button"
                  className="flex min-h-20 flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xs hover:border-brand-300 active:bg-brand-50 active:ring-2 active:ring-brand-500"
                  onClick={() => add(p, '1.000')}
                >
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</span>
                  <span className="mt-1 text-sm text-slate-600">
                    {formatArs(p.price)}
                    {isMeasured(p) && ` /${UNIT[p.saleMode]}`}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          favorites.data && <p className="text-sm text-slate-500">Cuando haya ventas, acá aparecen los artículos más vendidos para cargarlos con un toque.</p>
        )}
      </div>
      <Card className="flex h-fit flex-col lg:sticky lg:top-6">
        <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-900">Venta en curso</span>
          <span>{cart.lines.length === 1 ? '1 artículo' : `${cart.lines.length} artículos`}</span>
        </div>
        {cart.lines.length === 0 ? (
          <EmptyState>{lastSale ? `Venta N° ${lastSale.number} cobrada. Escaneá o tocá el primer artículo de la próxima.` : 'Escaneá o tocá el primer artículo para empezar la venta.'}</EmptyState>
        ) : (
          <ul aria-label="Artículos de la venta" className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
            {computed.map((l, i) => (
              <li key={l.product.variantId} aria-label={l.product.name} className="px-3 py-2">
                <button type="button" className="w-full rounded-lg px-1 py-0.5 text-left hover:bg-slate-50" onClick={() => setEditing({ product: l.product, index: i })}>
                  <span className="line-clamp-2 font-medium leading-snug">{l.product.name}</span>
                  <span className="block text-xs text-slate-500">
                    {formatArs(l.product.price)} {isMeasured(l.product) ? `/${UNIT[l.product.saleMode]}` : 'c/u'}
                    {dec(l.valid ? l.discountPercent : '0').gt(0) && <span className="ml-1 font-semibold text-emerald-700">−{toInputDecimal(l.discountPercent)} %</span>}
                  </span>
                </button>
                <div className="mt-1 flex items-center gap-1">
                  {!isMeasured(l.product) && (
                    <button type="button" aria-label={`Restar uno de ${l.product.name}`} disabled={!dec(l.quantity).gt(1)} className="flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 disabled:opacity-40" onClick={() => step(i, -1)}>
                      <Minus className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Cantidad de ${l.product.name}`}
                    aria-invalid={!isPositive(l.quantity) || undefined}
                    className="h-10 min-w-12 rounded-lg bg-slate-100 px-3 text-center font-semibold tabular-nums"
                    onClick={() => setEditing({ product: l.product, index: i })}
                  >
                    {formatQty(l.quantity, l.product.saleMode)}
                  </button>
                  {!isMeasured(l.product) && (
                    <button type="button" aria-label={`Sumar uno de ${l.product.name}`} className="flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700" onClick={() => step(i, 1)}>
                      <Plus className="size-4" />
                    </button>
                  )}
                  <span className="ml-auto font-semibold tabular-nums">{formatArs(l.amounts.total)}</span>
                  <button type="button" className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`Quitar ${l.product.name}`} onClick={() => remove(i)}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 border-t border-slate-200 p-4">
          {dec(discount).gt(0) && (
            <div className="flex justify-between text-sm text-slate-600">
              <span>Descuentos</span>
              <span>−{formatArs(discount)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-4xl font-bold tracking-tight" aria-label="Total de la venta">
              {formatArs(total)}
            </span>
          </div>
          <Button className="h-16 w-full text-xl" disabled={!allValid} onClick={() => setCheckout(true)}>
            Cobrar (F2)
          </Button>
          {cart.lines.length > 0 && (
            <Button variant="ghost" className="h-11 w-full" onClick={() => (setCart(emptyCart()), focusScanner())}>
              Cancelar la venta
            </Button>
          )}
          {lastSale && cart.lines.length === 0 && (
            <div className="space-y-2 border-t border-slate-200 pt-3 text-sm">
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
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" className="h-12" disabled={!tenant.data} onClick={() => setPrinting(lastSale)}>
                  <Printer className="size-4" /> Imprimir ticket
                </Button>
                {can('fiscal.issue', 'fiscal.manage') && (
                  <Button variant="secondary" className="h-12" onClick={() => setInvoicing(lastSale)}>
                    Facturar
                  </Button>
                )}
              </div>
            </div>
          )}
          {can('sales.read_own', 'sales.read_all') && (
            <Link to="/app/ventas" className="block text-center text-sm text-brand-700 hover:underline">
              Ver ventas
            </Link>
          )}
        </div>
      </Card>
      {editing && (
        <LineDialog
          key={`${editing.product.variantId}-${editing.index}`}
          product={editing.product}
          line={editingLine}
          adding={existing}
          onClose={() => (setEditing(null), focusScanner())}
          onSave={(quantity, discountPercent) => {
            if (editing.index === null) addQuantity(editing.product, quantity);
            else setLine(editing.index, { quantity, discountPercent });
            setEditing(null);
            focusScanner();
          }}
          onRemove={editing.index === null ? undefined : () => (remove(editing.index!), setEditing(null))}
        />
      )}
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
      {invoicing && <InvoiceDialog sale={invoicing} taxCondition={tenant.data?.taxCondition} canConfigure={can('fiscal.manage')} onClose={() => (setInvoicing(null), focusScanner())} />}
    </div>
  );
}

/**
 * Cantidad, peso o descuento de un artículo. Para lo que se vende por peso o medida también se
 * puede cargar el importe que pide el cliente ("$2.000 de queso") y se calcula la cantidad.
 */
function LineDialog({
  product,
  line,
  adding,
  onSave,
  onRemove,
  onClose,
}: {
  product: ProductDto;
  /** Línea que se edita; sin ella, se está agregando el artículo. */
  line?: CartLine;
  /** Al agregar, la línea que ya está en la venta: lo cargado se suma. */
  adding?: CartLine;
  onSave: (quantity: string, discountPercent: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const measured = isMeasured(product);
  const unit = UNIT[product.saleMode] ?? '';
  const canUseAmount = measured && dec(product.price).gt(0);
  const [keypad, toggleKeypad] = useKeypadPreference();
  const [quantity, setQuantity] = useState(line ? toInputDecimal(line.quantity) : '');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState(line && line.discountPercent !== '0' ? toInputDecimal(line.discountPercent) : '');
  const [target, setTarget] = useState<'quantity' | 'amount' | 'discount'>('quantity');

  function changeAmount(v: string) {
    setAmount(v);
    const a = parseDecimalInput(v);
    setQuantity(/^\d+(\.\d{1,2})?$/.test(a) && dec(a).gt(0) ? toInputDecimal(dec(a).div(product.price).toFixed(3)) : '');
  }
  const changeQuantity = (v: string) => (setQuantity(v), setAmount(''));
  const setters = { quantity: changeQuantity, amount: changeAmount, discount: setDiscount };
  const values = { quantity, amount, discount };

  const q = parseDecimalInput(quantity);
  const d = parseDecimalInput(discount) || '0';
  const quantityOk = QUANTITY_RE.test(q) && dec(q).gt(0) && (measured || /^\d+$/.test(q));
  const discountOk = DISCOUNT_RE.test(d) && dec(d).lte(100);
  const preview = quantityOk && discountOk ? saleLine(q, product.price, d).total : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={product.name} description={`${formatArs(product.price)} ${measured ? `por ${unit}` : 'por unidad'}`} wide={keypad}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (quantityOk && discountOk) onSave(dec(q).toFixed(3), dec(d).toFixed(2).replace(/\.?0+$/, '') || '0');
        }}
      >
        <div className={keypad ? 'grid gap-5 md:grid-cols-[1fr_15rem]' : ''}>
          <div className="space-y-4">
            {adding && <p className="text-sm text-slate-600">Ya hay {formatQty(adding.quantity, product.saleMode)} en la venta: lo que cargues se suma.</p>}
            <Field label={measured ? `Cantidad (${unit})` : 'Cantidad'} error={quantity && !quantityOk ? (measured ? 'Hasta 3 decimales y mayor a cero' : 'Cantidad entera mayor a cero') : undefined}>
              {(p) => <Input {...p} className="h-14 text-right text-2xl font-semibold" inputMode={keypad ? 'none' : 'decimal'} autoFocus={!keypad} placeholder="0" value={quantity} onFocus={() => setTarget('quantity')} onChange={(e) => changeQuantity(e.target.value)} />}
            </Field>
            {product.saleMode === 'weight' && (
              <div className="grid grid-cols-4 gap-2">
                {[['0.1', '100 g'], ['0.25', '¼ kg'], ['0.5', '½ kg'], ['1', '1 kg']].map(([value, label]) => (
                  <Button key={value} variant="secondary" className="h-11" onClick={() => changeQuantity(toInputDecimal(value!))}>
                    {label}
                  </Button>
                ))}
              </div>
            )}
            {canUseAmount && (
              <Field label="O el importe que pide el cliente ($)" hint="Se calcula la cantidad con el precio vigente.">
                {(p) => <Input {...p} className="h-12 text-right text-lg" inputMode={keypad ? 'none' : 'decimal'} placeholder="0" value={amount} onFocus={() => setTarget('amount')} onChange={(e) => changeAmount(e.target.value)} />}
              </Field>
            )}
            {line && (
              <Field label="Descuento %" error={!discountOk ? 'Entre 0 y 100, con hasta 2 decimales' : undefined}>
                {(p) => <Input {...p} className="h-12 text-right text-lg" inputMode={keypad ? 'none' : 'decimal'} placeholder="0" value={discount} onFocus={() => setTarget('discount')} onChange={(e) => setDiscount(e.target.value)} />}
              </Field>
            )}
            <div className="flex items-baseline justify-between rounded-lg bg-slate-100 p-4">
              <span className="text-sm text-slate-600">Importe</span>
              <span className="text-2xl font-bold">{preview ? formatArs(preview) : '—'}</span>
            </div>
          </div>
          {keypad && <NumPad value={values[target]} onChange={setters[target]} decimals={target !== 'quantity' || measured} />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={toggleKeypad}>
            {keypad ? 'Ocultar teclado en pantalla' : 'Teclado en pantalla'}
          </Button>
          <div className="flex gap-2">
            {onRemove && (
              <Button variant="secondary" className="h-12 text-red-700" onClick={onRemove}>
                <Trash2 className="size-4" /> Quitar
              </Button>
            )}
            <Button type="submit" className="h-12 min-w-32 text-base" disabled={!quantityOk || !discountOk}>
              {line ? 'Listo' : 'Agregar'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Importes sugeridos para cobrar en efectivo: billetes que alcanzan a cubrir lo que falta. */
function cashSuggestions(remaining: string): string[] {
  const r = dec(remaining);
  if (!r.gt(0)) return [];
  const values = [1000, 2000, 5000, 10000, 20000].map((bill) => r.div(bill).ceil().times(bill)).filter((v) => v.gt(r));
  return [...new Set(values.map((v) => v.toFixed(0)))].sort((a, b) => Number(a) - Number(b)).slice(0, 4);
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
  const [active, setActive] = useState(0);
  const [target, setTarget] = useState<'amount' | 'reference' | 'phone'>('amount');
  const [keypad, toggleKeypad] = useKeypadPreference();
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
  const row = rows[active]!;
  const method = byId.get(row.paymentMethodId);
  const others = sumMoney(amounts.filter((a, i) => i !== active && /^\d+(\.\d{1,2})?$/.test(a)));
  const rest = dec(total).minus(others);
  const remaining = rest.gt(0) ? roundMoney(rest) : '0.00';

  const confirm = useMutation({
    mutationFn: (authorization: Authorization) => {
      const body = createSaleSchema.parse({
        clientUuid: cart.clientUuid,
        registerId,
        lines: cart.lines.map((l) => ({ variantId: l.product.variantId, quantity: l.quantity, discountPercent: l.discountPercent })),
        payments: rows
          .map((r, i) => {
            const payer = PAYER_KINDS.includes(byId.get(r.paymentMethodId)?.kind ?? 'cash');
            return { paymentMethodId: r.paymentMethodId, amount: amounts[i]!, reference: r.reference || null, payerName: (payer && r.payerName?.trim()) || null, payerPhone: (payer && r.payerPhone?.trim()) || null };
          })
          .filter((p) => dec(p.amount).gt(0)),
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
    const missingRef = rows.findIndex((r, i) => byId.get(r.paymentMethodId)?.requiresReference && !r.reference.trim() && dec(amounts[i]!).gt(0));
    if (missingRef !== -1) {
      setActive(missingRef);
      setTarget('reference');
      return setError(`Cargá el número de operación de ${byId.get(rows[missingRef]!.paymentMethodId)!.name}`);
    }
    setError(null);
    confirm.mutate(null);
  }
  const setRow = (i: number, patch: Partial<PaymentRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const choose = (methodId: string) => {
    setRow(active, { paymentMethodId: methodId });
    setTarget(byId.get(methodId)?.requiresReference ? 'reference' : 'amount');
  };
  const splitRest = () => {
    const other = methods.find((m) => m.kind !== 'cash') ?? cash;
    setRows((rs) => [...rs, { paymentMethodId: other?.id ?? '', amount: toInputDecimal(roundMoney(missing)), reference: '' }]);
    setActive(rows.length);
    setTarget('amount');
  };
  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setActive(0);
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !confirm.isPending && onClose()} title="Cobrar" description={`Total ${formatArs(total)}`} wide>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          {rows.length > 1 && (
            <div className="flex flex-wrap gap-2" aria-label="Pagos">
              {rows.map((r, i) => (
                <span key={i} className={`inline-flex items-center rounded-full border text-sm ${i === active ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
                  <button type="button" className="py-2 pl-3 pr-2" aria-pressed={i === active} onClick={() => setActive(i)}>
                    Pago {i + 1} · {byId.get(r.paymentMethodId)?.name} · {/^\d+(\.\d{1,2})?$/.test(amounts[i]!) ? formatArs(amounts[i]!) : '—'}
                  </button>
                  <button type="button" className="rounded-full p-2 text-slate-500 hover:text-red-700" aria-label={`Quitar el pago ${i + 1}`} onClick={() => removeRow(i)}>
                    <X className="size-4" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={keypad ? 'grid gap-5 md:grid-cols-[1fr_15rem]' : ''}>
            <div className="space-y-4">
              <div role="group" aria-label={`Medio de pago ${active + 1}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={m.id === row.paymentMethodId}
                    className={`h-14 rounded-xl border px-3 text-sm font-semibold ${m.id === row.paymentMethodId ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white hover:border-brand-300'}`}
                    onClick={() => choose(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              <Field label={method?.kind === 'cash' ? 'Recibido en efectivo' : 'Importe'}>
                {(p) => (
                  <Input
                    {...p}
                    aria-label={`Importe ${active + 1}`}
                    className="h-14 text-right text-2xl font-semibold"
                    inputMode={keypad ? 'none' : 'decimal'}
                    autoFocus={!keypad}
                    placeholder={active === 0 && rows.length === 1 ? toInputDecimal(total) : ''}
                    value={row.amount}
                    onFocus={() => setTarget('amount')}
                    onChange={(e) => setRow(active, { amount: e.target.value })}
                  />
                )}
              </Field>
              {method?.kind === 'cash' && dec(remaining).gt(0) && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" className="h-11" onClick={() => setRow(active, { amount: toInputDecimal(remaining) })}>
                    Justo
                  </Button>
                  {cashSuggestions(remaining).map((v) => (
                    <Button key={v} variant="secondary" className="h-11" onClick={() => setRow(active, { amount: v })}>
                      $ {Number(v).toLocaleString('es-AR')}
                    </Button>
                  ))}
                </div>
              )}
              {method && PAYER_KINDS.includes(method.kind) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Nombre de quien paga ${active + 1} (opcional)`}>
                    {(p) => <Input {...p} className="h-12" autoComplete="off" maxLength={120} value={row.payerName ?? ''} onChange={(e) => setRow(active, { payerName: e.target.value })} />}
                  </Field>
                  <Field label={`Teléfono ${active + 1} (opcional)`}>
                    {(p) => <Input {...p} className="h-12" type="tel" inputMode={keypad ? 'none' : 'tel'} autoComplete="off" maxLength={30} value={row.payerPhone ?? ''} onFocus={() => setTarget('phone')} onChange={(e) => setRow(active, { payerPhone: e.target.value })} />}
                  </Field>
                </div>
              )}
              {method?.requiresReference && (
                <Field label={`N° de operación ${active + 1}`}>
                  {(p) => <Input {...p} className="h-12 text-lg" inputMode={keypad ? 'none' : 'text'} autoComplete="off" autoFocus={!keypad && target === 'reference'} value={row.reference} onFocus={() => setTarget('reference')} onChange={(e) => setRow(active, { reference: e.target.value })} />}
                </Field>
              )}
            </div>
            {keypad && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500">{target === 'reference' ? 'Escribiendo el N° de operación' : target === 'phone' ? 'Escribiendo el teléfono' : 'Escribiendo el importe'}</p>
                <NumPad
                  value={target === 'reference' ? row.reference : target === 'phone' ? (row.payerPhone ?? '') : row.amount}
                  decimals={target === 'amount'}
                  onChange={(v) => setRow(active, target === 'reference' ? { reference: v } : target === 'phone' ? { payerPhone: v } : { amount: v })}
                />
              </div>
            )}
          </div>
          <Button variant="secondary" className="h-11" disabled={rows.length >= 10 || !missing.gt(0)} onClick={splitRest}>
            <Plus className="size-4" /> Pagar el resto con otro medio
          </Button>
          <div className="space-y-1 rounded-xl bg-slate-100 p-4">
            <div className="flex justify-between text-sm">
              <span>Pagado</span>
              <span className="font-semibold">{formatArs(paid)}</span>
            </div>
            {missing.gt(0) ? (
              <div className="flex items-baseline justify-between text-red-700">
                <span className="text-lg">Falta</span>
                <span className="text-3xl font-bold">{formatArs(roundMoney(missing))}</span>
              </div>
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-lg">Vuelto</span>
                <span className="text-3xl font-bold">{formatArs(change)}</span>
              </div>
            )}
            {dec(nonCash).gt(total) && <p className="text-sm text-red-700">Con tarjeta, transferencia o QR no se da vuelto: el importe no puede superar el total.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={toggleKeypad}>
              {keypad ? 'Ocultar teclado en pantalla' : 'Teclado en pantalla'}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" className="h-14" onClick={onClose} disabled={confirm.isPending}>
                Volver
              </Button>
              <Button type="submit" className="h-14 min-w-48 text-lg" loading={confirm.isPending && !pin} disabled={!ready}>
                Confirmar venta
              </Button>
            </div>
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
