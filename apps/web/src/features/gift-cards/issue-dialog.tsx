import { createGiftCardSchema, GIFT_CARD_MAX_MONTHS, type PaymentMethodDto, type SaleDto } from '@gc/contracts';
import { dec, formatArs, roundMoney } from '@gc/domain';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { newClientUuid } from '@/features/catalog/queries';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/misc';
import { ApiRequestError, errorMessage, http } from '@/lib/api';
import { parseDecimalInput } from '@/lib/format';

const MONEY = /^\d+(\.\d{1,2})?$/;

/**
 * Venta de una gift card (ADR 0015): se cobra como cualquier venta, con el medio que sea, y
 * queda un saldo para usar en una o varias compras hasta que vence.
 */
export function IssueGiftCardDialog({ registerId, methods, onClose, onDone }: { registerId: string; methods: PaymentMethodDto[]; onClose: () => void; onDone: (sale: SaleDto) => void }) {
  const [clientUuid] = useState(newClientUuid);
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState(GIFT_CARD_MAX_MONTHS);
  const [recipient, setRecipient] = useState('');
  const [from, setFrom] = useState('');
  const [message, setMessage] = useState('');
  const [methodId, setMethodId] = useState('');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const method = methods.find((m) => m.id === methodId) ?? methods.find((m) => m.kind === 'cash') ?? methods[0];
  const value = parseDecimalInput(amount);
  const valid = MONEY.test(value) && dec(value).gt(0);
  const isCash = method?.kind === 'cash';
  const paid = isCash && received.trim() ? parseDecimalInput(received) : value;
  const change = valid && isCash && MONEY.test(paid) && dec(paid).gt(value) ? roundMoney(dec(paid).minus(value)) : '0.00';

  const issue = useMutation({
    mutationFn: (body: unknown) => http.post<SaleDto>('/gift-cards', body),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR' ? (Object.values(err.fieldErrors())[0] ?? err.message) : errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return setError('Ingresá el monto de la gift card');
    if (!method) return setError('No hay medios de pago activos');
    if (isCash && (!MONEY.test(paid) || dec(paid).lt(value))) return setError(`Falta cobrar ${formatArs(roundMoney(dec(value).minus(MONEY.test(paid) ? paid : '0')))}`);
    if (method.requiresReference && !reference.trim()) return setError(`Cargá el número de operación de ${method.name}`);
    const parsed = createGiftCardSchema.safeParse({
      clientUuid, registerId, amount: value, validMonths: months, recipientName: recipient, fromName: from, message,
      payments: [{ paymentMethodId: method.id, amount: paid, reference: reference.trim() || null }],
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
    setError(null);
    issue.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !issue.isPending && onClose()} title="Vender gift card" description="Queda un saldo para usar en una o varias compras, en cualquier sucursal.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto">{(p) => <Input {...p} autoFocus inputMode="decimal" className="h-12 text-right text-xl font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Válida por">
            {(p) => (
              <Select {...p} className="h-12" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>
                {Array.from({ length: GIFT_CARD_MAX_MONTHS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? '1 mes' : `${n} meses`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Para (opcional)">{(p) => <Input {...p} maxLength={80} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Quien la recibe" />}</Field>
          <Field label="De (opcional)">{(p) => <Input {...p} maxLength={80} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Quien la regala" />}</Field>
          <div className="sm:col-span-2">
            <Field label="Dedicatoria (opcional)" hint="Sale impresa en la tarjeta de regalo.">
              {(p) => <textarea {...p} rows={2} maxLength={200} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="¡Feliz cumpleaños! Que lo disfrutes." />}
            </Field>
          </div>
          <Field label="Cobra con">
            {(p) => (
              <Select {...p} value={method?.id ?? ''} onChange={(e) => (setMethodId(e.target.value), setReceived(''), setReference(''))}>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isCash && (
            <Field label="Recibido en efectivo" hint={dec(change).gt(0) ? `Vuelto ${formatArs(change)}` : undefined}>
              {(p) => <Input {...p} inputMode="decimal" placeholder={valid ? value : ''} value={received} onChange={(e) => setReceived(e.target.value)} />}
            </Field>
          )}
          {method?.requiresReference && <Field label="N° de operación">{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={issue.isPending}>
            Volver
          </Button>
          <Button type="submit" loading={issue.isPending}>
            Cobrar {valid ? formatArs(value) : ''}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
