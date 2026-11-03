import { type GiftCardDto, type GiftCardListDto, type GiftCardState } from '@gc/contracts';
import { formatArs } from '@gc/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Forbidden } from '@/features/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, Card, EmptyState, PageHeader, Pager, Spinner, Table, Td, Th } from '@/components/ui/misc';
import { errorMessage, http } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { formatExpiry, formatGiftCardCode } from './gift-card-ticket';

const PAGE_SIZE = 25;

export const GIFT_CARD_STATES: Record<GiftCardState, { label: string; tone: 'green' | 'slate' | 'amber' | 'red' }> = {
  active: { label: 'Vigente', tone: 'green' },
  used: { label: 'Usada', tone: 'slate' },
  expired: { label: 'Vencida', tone: 'amber' },
  voided: { label: 'Anulada', tone: 'red' },
};

const MOVEMENT_LABELS = { issue: 'Venta de la tarjeta', redeem: 'Compra', reversal: 'Anulación de la compra', void: 'Anulación de la tarjeta' } as const;

/** Gift cards vendidas (ADR 0015): saldo de cada una y lo que el comercio todavía debe en mercadería. */
export function GiftCardsPage() {
  const can = useCan();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [state, setState] = useState<GiftCardState | ''>('');
  const [lookup, setLookup] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q.trim()) params.set('q', q.trim());
  if (state) params.set('state', state);
  const cards = useQuery({ queryKey: ['gift-cards', params.toString()], queryFn: () => http.get<GiftCardListDto>(`/gift-cards?${params}`), placeholderData: keepPreviousData, enabled: can('sales.read_all') });

  if (!can('sales.read_all')) return <Forbidden />;
  return (
    <>
      <PageHeader title="Gift cards" description="Se venden desde Vender y se usan como medio de pago al cobrar, en una o varias compras." />
      {cards.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-sm text-slate-600">Saldo vigente a favor de los clientes</p>
            <p className="font-display text-3xl font-bold tabular-nums">{formatArs(cards.data.outstanding.amount)}</p>
            <p className="text-xs text-slate-500">
              {cards.data.outstanding.count === 1 ? '1 gift card vigente' : `${cards.data.outstanding.count} gift cards vigentes`}: mercadería que todavía se tiene que entregar.
            </p>
          </Card>
          <Card className="p-4">
            <form
              className="flex h-full flex-col justify-between gap-2"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const code = new FormData(e.currentTarget).get('code')?.toString().trim();
                if (code) setLookup(code);
              }}
            >
              <label htmlFor="gift-code" className="text-sm text-slate-600">
                Consultar saldo
              </label>
              <div className="flex gap-2">
                <Input id="gift-code" name="code" autoComplete="off" placeholder="Escaneá o escribí el código" />
                <Button type="submit" variant="secondary">
                  Consultar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <Input aria-label="Buscar gift card" placeholder="Código o nombre" className="w-64" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          <Select aria-label="Estado" className="w-48" value={state} onChange={(e) => (setState(e.target.value as GiftCardState | ''), setPage(1))}>
            <option value="">Todas</option>
            {Object.entries(GIFT_CARD_STATES).map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {cards.isLoading && <Spinner />}
        {cards.error && <Alert>{errorMessage(cards.error)}</Alert>}
        {cards.data && cards.data.items.length === 0 && <EmptyState>{q || state ? 'No hay gift cards con esos filtros.' : 'Todavía no se vendió ninguna gift card. Se venden desde Vender → «Vender gift card».'}</EmptyState>}
        {cards.data && cards.data.items.length > 0 && (
          <Table
            head={
              <>
                <Th>Código</Th>
                <Th>Para</Th>
                <Th>Vendida</Th>
                <Th>Vence</Th>
                <Th className="text-right">Monto</Th>
                <Th className="text-right">Saldo</Th>
                <Th>Estado</Th>
              </>
            }
          >
            {cards.data.items.map((c) => (
              <tr key={c.id}>
                <Td>
                  <button type="button" className="-my-2 inline-flex min-h-10 items-center font-mono font-semibold text-brand-700 hover:underline" onClick={() => setLookup(c.code)}>
                    {formatGiftCardCode(c.code)}
                  </button>
                </Td>
                <Td>{c.recipientName ?? '—'}</Td>
                <Td>{formatDateTime(c.createdAt)}</Td>
                <Td>{formatExpiry(c.expiresOn)}</Td>
                <Td className="text-right">{formatArs(c.amount)}</Td>
                <Td className="text-right font-semibold">{formatArs(c.balance)}</Td>
                <Td>
                  <Badge tone={GIFT_CARD_STATES[c.state].tone}>{GIFT_CARD_STATES[c.state].label}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {cards.data && <Pager page={page} pageSize={PAGE_SIZE} total={cards.data.total} onPage={setPage} />}
      </Card>
      {lookup && <GiftCardDetailDialog code={lookup} onClose={() => setLookup(null)} />}
    </>
  );
}

/** Saldo y usos de una gift card. */
export function GiftCardDetailDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const card = useQuery({ queryKey: ['gift-cards', 'lookup', code], queryFn: () => http.get<GiftCardDto>(`/gift-cards/lookup?code=${encodeURIComponent(code)}`), retry: false });
  const c = card.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={c ? `Gift card ${formatGiftCardCode(c.code)}` : 'Gift card'} description={c ? `${c.recipientName ? `Para ${c.recipientName} · ` : ''}Vence el ${formatExpiry(c.expiresOn)}` : undefined}>
      {card.isLoading && <Spinner />}
      {card.error && <Alert>{errorMessage(card.error)}</Alert>}
      {c && (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between rounded-xl bg-slate-100 p-4">
            <span>
              Saldo <Badge tone={GIFT_CARD_STATES[c.state].tone}>{GIFT_CARD_STATES[c.state].label}</Badge>
            </span>
            <span className="text-3xl font-bold tabular-nums">{formatArs(c.balance)}</span>
          </div>
          <ul className="divide-y divide-slate-100 text-sm" aria-label="Movimientos de la gift card">
            {(c.movements ?? []).map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {MOVEMENT_LABELS[m.kind]}
                  {m.sale && (
                    <>
                      {' · '}
                      <Link to="/app/ventas/$id" params={{ id: m.sale.id }} className="font-semibold text-brand-700 hover:underline" onClick={onClose}>
                        venta N° {m.sale.number}
                      </Link>
                    </>
                  )}
                  <span className="block text-xs text-slate-500">{formatDateTime(m.createdAt)}</span>
                </span>
                <span className="text-right tabular-nums">
                  <span className={`block font-semibold ${m.amount.startsWith('-') ? 'text-red-700' : 'text-emerald-700'}`}>{formatArs(m.amount)}</span>
                  <span className="text-xs text-slate-500">Saldo {formatArs(m.balanceAfter)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
