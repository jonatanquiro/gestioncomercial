import { describe, expect, it } from 'vitest';
import { exchangeDeadline, parseSaleTicketCode, saleTicketCode } from './exchange-ticket';

describe('ticket de cambio', () => {
  it('codifica y lee el número de venta', () => {
    expect(saleTicketCode(123)).toBe('V123');
    expect(parseSaleTicketCode('V123')).toBe(123);
    expect(parseSaleTicketCode(' v000123 ')).toBe(123);
    expect(parseSaleTicketCode('7790001234567')).toBeNull();
    expect(parseSaleTicketCode('VX1')).toBeNull();
  });

  it('calcula el último día del plazo', () => {
    const d = exchangeDeadline('2026-11-03T15:00:00', 30)!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 12, 3]);
    expect(exchangeDeadline('2026-11-03T15:00:00', 0)).toBeNull();
  });
});
