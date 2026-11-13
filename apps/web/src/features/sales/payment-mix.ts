import { dec, listAmountFor, mixedSurcharge, roundMoney, sumMoney } from '@gc/domain';

/**
 * Cobro con precio de contado y de lista (ADR 0023 y 0029), igual que SalesService::paymentMix.
 * - «De contado» (cashLike): medios marcados «cobra a precio de contado», gift cards y, si el
 *   comercio da plazo, lo que queda a cuenta corriente.
 * - El resto (nonCash) paga a precio de lista la parte que cubre: si todo va así, la venta va
 *   entera a lista; si se combina, se suma el recargo solo sobre esa parte.
 */
export interface PaymentMix {
  cashTotal: string;
  listTotal: string;
  cashLike: string[];
  nonCash: string[];
}

export function saleTotal(m: PaymentMix): { total: string; surcharge: string; mode: 'cash' | 'list' | 'mixed' } {
  const cashLike = sumMoney(m.cashLike);
  const nonCash = sumMoney(m.nonCash);
  if (!dec(m.listTotal).gt(m.cashTotal)) return { total: m.listTotal, surcharge: '0.00', mode: dec(cashLike).gt(0) && !dec(nonCash).gt(0) ? 'cash' : 'list' };
  if (!dec(cashLike).gt(0)) return { total: m.listTotal, surcharge: '0.00', mode: 'list' };
  if (!dec(nonCash).gt(0)) return { total: m.cashTotal, surcharge: '0.00', mode: 'cash' };
  const surcharge = mixedSurcharge(nonCash, m.cashTotal, m.listTotal);
  return { total: roundMoney(dec(m.cashTotal).plus(surcharge)), surcharge, mode: 'mixed' };
}

/** Lo que falta cobrar si el resto se paga con un medio de contado («cash») o con otro («list»). */
export function remainingFor(kind: 'cash' | 'list', m: PaymentMix): string {
  const cashLike = sumMoney(m.cashLike);
  const nonCash = sumMoney(m.nonCash);
  const positive = (v: ReturnType<typeof dec>) => (v.gt(0) ? roundMoney(v) : '0.00');
  if (kind === 'cash') {
    const { total } = saleTotal({ ...m, cashLike: [...m.cashLike, '0.01'] });
    return positive(dec(total).minus(cashLike).minus(nonCash));
  }
  if (!dec(cashLike).gt(0)) return positive(dec(m.listTotal).minus(nonCash));
  const target = dec(m.cashTotal).minus(cashLike);
  if (!target.gt(0)) return '0.00';
  return positive(dec(listAmountFor(target, m.cashTotal, m.listTotal)).minus(nonCash));
}

/** Lo que se suma a la deuda si el saldo a cuenta vence: la venta entera pasa a lista. */
export function lateSurcharge(m: PaymentMix): string {
  const { surcharge } = saleTotal(m);
  const v = dec(m.listTotal).minus(m.cashTotal).minus(surcharge);
  return v.gt(0) ? roundMoney(v) : '0.00';
}
