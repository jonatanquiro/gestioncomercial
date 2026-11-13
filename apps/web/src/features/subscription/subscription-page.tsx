import type { SubscriptionCheckoutResult, SubscriptionDto, SubscriptionPaymentDto, SubscriptionState, SubscriptionStateDto } from '@gc/contracts';
import { dec, formatArs } from '@gc/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { Alert, Badge, Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, http } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionState, string> = {
  free: 'Sin vencimiento',
  trial: 'En prueba',
  active: 'Al día',
  grace: 'Pago pendiente',
  expired: 'Pausada',
};

const STATE_TONE: Record<SubscriptionState, 'green' | 'brand' | 'amber' | 'red' | 'slate'> = {
  free: 'green',
  trial: 'brand',
  active: 'green',
  grace: 'amber',
  expired: 'red',
};

const PAYMENT_STATUS: Record<SubscriptionPaymentDto['status'], string> = {
  approved: 'Acreditado',
  pending: 'Pendiente de acreditación',
  rejected: 'Rechazado',
  refunded: 'Reembolsado',
  error: 'No se inició',
};

/** Días que faltan hasta la fecha (redondeado hacia arriba): 0 si ya pasó. */
export function daysUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

const days = (n: number) => (n === 1 ? '1 día' : `${n} días`);
const months = (n: number) => (n === 1 ? '1 mes' : `${n} meses`);

/** Aviso del menú cuando la suscripción vence pronto o ya venció. Null si no hace falta avisar. */
export function subscriptionNotice(s: SubscriptionStateDto | null): string | null {
  if (!s) return null;
  if (s.state === 'grace') return `La suscripción venció el ${formatDate(s.dueAt!)}. El acceso se pausa el ${formatDate(s.blockAt!)} si no se registra el pago.`;
  if ((s.state === 'trial' || s.state === 'active') && daysUntil(s.dueAt) <= 7) {
    const left = daysUntil(s.dueAt);
    const what = s.state === 'trial' ? 'La prueba gratis' : 'La suscripción';
    return left === 0 ? `${what} vence hoy.` : `${what} vence en ${days(left)}, el ${formatDate(s.dueAt!)}.`;
  }
  return null;
}

function StateText({ s }: { s: SubscriptionDto }) {
  switch (s.state) {
    case 'free':
      return <>{s.freeForever ? 'Tu licencia no tiene vencimiento.' : 'Tu plan no tiene costo.'}</>;
    case 'trial':
      return <>Prueba gratis hasta el <strong>{formatDate(s.dueAt!)}</strong> ({days(daysUntil(s.dueAt))}).</>;
    case 'active':
      return <>Pagado hasta el <strong>{formatDate(s.dueAt!)}</strong>.</>;
    case 'grace':
      return <>Venció el <strong>{formatDate(s.dueAt!)}</strong>. Podés seguir operando hasta el <strong>{formatDate(s.blockAt!)}</strong>; después se pausa hasta que se registre el pago.</>;
    case 'expired':
      return <>La cuenta está pausada desde el <strong>{formatDate(s.blockAt!)}</strong>. Tus datos están guardados y vuelven a estar disponibles apenas se acredite el pago.</>;
  }
}

function PayForm({ s }: { s: SubscriptionDto }) {
  const toast = useToast();
  const [planCode, setPlanCode] = useState(s.plans.some((p) => p.code === s.plan?.code) ? s.plan!.code : (s.plans[0]?.code ?? ''));
  const [count, setCount] = useState(s.monthOptions[0] ?? 1);
  const plan = s.plans.find((p) => p.code === planCode);
  const checkout = useMutation({
    mutationFn: () => http.post<SubscriptionCheckoutResult>('/subscription/checkout', { planCode, months: count }),
    onSuccess: (res) => window.location.assign(res.url),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); checkout.mutate(); }}>
      {s.plans.length > 1 && (
        <Field label="Plan" hint={planCode !== s.plan?.code ? 'El comercio pasa a este plan cuando se acredita el pago.' : undefined}>
          {(p) => (
            <Select {...p} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
              {s.plans.map((pl) => <option key={pl.code} value={pl.code}>{pl.name} · {formatArs(pl.price)} por mes</option>)}
            </Select>
          )}
        </Field>
      )}
      <Field label="Cuántos meses pagar">
        {(p) => (
          <Select {...p} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {s.monthOptions.map((m) => <option key={m} value={m}>{months(m)}{plan ? ` · ${formatArs(dec(plan.price).times(m))}` : ''}</option>)}
          </Select>
        )}
      </Field>
      <Button type="submit" loading={checkout.isPending} disabled={!plan}>Pagar con Mercado Pago</Button>
      <p className="text-xs text-slate-500">Con tarjeta, dinero en cuenta o efectivo desde Mercado Pago. El vencimiento se actualiza solo cuando se acredita.</p>
    </form>
  );
}

/** Vuelta desde Mercado Pago: el número de pago es solo una pista, el servidor le pregunta a Mercado Pago. */
function useReturnFromCheckout() {
  const search = useSearch({ strict: false }) as { pago?: string; payment_id?: string; collection_id?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const done = useRef(false);
  useEffect(() => {
    if (!search.pago || done.current) return;
    done.current = true;
    const hint = [search.payment_id, search.collection_id].find((v) => v && v !== 'null') ?? null;
    http.post<SubscriptionPaymentDto>(`/subscription/payments/${search.pago}/check`, { mpPaymentId: hint })
      .then(async (p) => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['subscription'] }), queryClient.invalidateQueries({ queryKey: ['me'] })]);
        if (p.status === 'approved') toast('¡Listo! Recibimos el pago y la suscripción quedó al día.');
        else if (p.status === 'pending') toast('El pago quedó pendiente en Mercado Pago. Apenas se acredite, la suscripción se actualiza sola.');
        else toast('El pago no se completó. Podés intentarlo de nuevo.', 'error');
      })
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => void navigate({ to: '/app/suscripcion', search: {}, replace: true }));
  }, [search, navigate, queryClient, toast]);
}

export function SubscriptionPage() {
  const can = useCan();
  const query = useQuery({ queryKey: ['subscription'], queryFn: () => http.get<SubscriptionDto>('/subscription'), enabled: can('subscription.manage') });
  useReturnFromCheckout();
  if (!can('subscription.manage')) return <Alert kind="info">La suscripción la gestiona el propietario del comercio.</Alert>;
  const s = query.data;
  return (
    <>
      <PageHeader title="Suscripción" description="Tu plan, hasta cuándo está pagado y cómo renovarlo." />
      {query.isLoading && <Spinner />}
      {query.error && <Alert>{errorMessage(query.error)}</Alert>}
      {s && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display text-xl font-semibold">{s.plan ? `Plan ${s.plan.name}` : 'Sin plan'}</h2>
                <Badge tone={STATE_TONE[s.state]}>{SUBSCRIPTION_STATE_LABELS[s.state]}</Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-700"><StateText s={s} /></p>
              {s.plan && !dec(s.plan.price).isZero() && <p className="mt-2 text-sm text-slate-500">{formatArs(s.plan.price)} por mes.</p>}
            </Card>
            {s.state !== 'free' && (
              <Card className="p-6">
                <h2 className="mb-4 font-display text-xl font-semibold">Renovar</h2>
                {s.mercadoPago && s.plans.length > 0
                  ? <PayForm s={s} />
                  : <p className="text-sm text-slate-600">Para renovar, comunicate con nosotros y registramos el pago.</p>}
              </Card>
            )}
          </div>
          {s.payments.length > 0 && (
            <Card>
              <h2 className="px-6 pt-5 font-display text-lg font-semibold">Pagos</h2>
              <Table head={<><Th>Fecha</Th><Th>Plan</Th><Th>Período</Th><Th>Medio</Th><Th>Estado</Th><Th className="text-right">Importe</Th></>}>
                {s.payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap">{formatDate(p.createdAt)}</Td>
                    <Td>{p.planName ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{p.periodFrom && p.periodTo ? `${formatDate(p.periodFrom)} al ${formatDate(p.periodTo)}` : months(p.months)}</Td>
                    <Td>{p.method === 'mercadopago' ? 'Mercado Pago' : 'Transferencia u otro'}</Td>
                    <Td>{PAYMENT_STATUS[p.status]}</Td>
                    <Td className="text-right tabular-nums">{formatArs(p.amount)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

/** Comercio pausado por falta de pago: quien gestiona la suscripción la puede pagar desde acá. */
export function SubscriptionExpiredPage({ onLogout }: { onLogout: () => void }) {
  const me = useMe();
  const can = useCan();
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="font-display text-lg font-semibold">{me.tenant?.tradeName}</p>
        <button className="text-sm text-brand-700 hover:underline" onClick={onLogout}>Cerrar sesión</button>
      </div>
      {can('subscription.manage')
        ? <SubscriptionPage />
        : <Alert kind="info">El acceso a {me.tenant?.tradeName} está pausado porque venció la suscripción. Avisale al propietario del comercio para que la renueve: tus datos están guardados.</Alert>}
    </main>
  );
}
