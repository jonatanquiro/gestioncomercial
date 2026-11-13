import { describe, expect, it } from 'vitest';
import { lateSurcharge, remainingFor, saleTotal } from './payment-mix';

const sale = { cashTotal: '50000.00', listTotal: '60000.00' };

describe('cobro con precio de contado y de lista', () => {
  it('todo en efectivo va a contado y todo con tarjeta va a lista', () => {
    expect(saleTotal({ ...sale, cashLike: ['50000'], nonCash: [] })).toEqual({ total: '50000.00', surcharge: '0.00', mode: 'cash' });
    expect(saleTotal({ ...sale, cashLike: [], nonCash: ['60000'] })).toEqual({ total: '60000.00', surcharge: '0.00', mode: 'list' });
    expect(remainingFor('list', { ...sale, cashLike: [], nonCash: [] })).toBe('60000.00');
    expect(remainingFor('cash', { ...sale, cashLike: [], nonCash: [] })).toBe('50000.00');
  });

  it('efectivo más tarjeta: el recargo va solo sobre lo que paga la tarjeta', () => {
    expect(remainingFor('list', { ...sale, cashLike: ['30000'], nonCash: [] })).toBe('24000.00');
    expect(remainingFor('cash', { ...sale, cashLike: ['30000'], nonCash: [] })).toBe('20000.00');
    expect(saleTotal({ ...sale, cashLike: ['30000'], nonCash: ['24000'] })).toEqual({ total: '54000.00', surcharge: '4000.00', mode: 'mixed' });
  });

  it('el ejemplo de 11.700 / 14.700 con 3.000 en efectivo cierra al centavo', () => {
    const m = { cashTotal: '11700.00', listTotal: '14700.00', cashLike: ['3000'], nonCash: [] as string[] };
    const card = remainingFor('list', m);
    expect(card).toBe('10930.77');
    const { total } = saleTotal({ ...m, nonCash: [card] });
    expect(total).toBe('13930.77');
    expect(remainingFor('cash', { ...m, nonCash: [card] })).toBe('0.00');
  });

  it('con tarjeta ya cargada, lo que falta en efectivo usa el total con recargo', () => {
    expect(remainingFor('cash', { ...sale, cashLike: [], nonCash: ['12000'] })).toBe('40000.00');
  });

  it('saldo a cuenta: al vencer suma la diferencia de lista que no se cobró', () => {
    expect(lateSurcharge({ ...sale, cashLike: ['30000', '20000'], nonCash: [] })).toBe('10000.00');
    // Si una parte se pagó con tarjeta, su recargo ya se cobró.
    expect(lateSurcharge({ ...sale, cashLike: ['20000', '20000'], nonCash: ['12000'] })).toBe('8000.00');
  });

  it('sin precio de contado distinto no hay recargo', () => {
    const same = { cashTotal: '1000.00', listTotal: '1000.00' };
    expect(saleTotal({ ...same, cashLike: ['400'], nonCash: ['600'] }).total).toBe('1000.00');
    expect(remainingFor('list', { ...same, cashLike: ['400'], nonCash: [] })).toBe('600.00');
  });
});
