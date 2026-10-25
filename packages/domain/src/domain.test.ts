import { describe, expect, it } from 'vitest';
import { dec, formatArs, roundMoney, sumMoney } from './money';
import { marginPercentOf, markupPercentOf, priceFromMargin, priceFromMarkup, roundPriceUp } from './pricing';

describe('money', () => {
  it('evita errores de punto flotante', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.30');
    expect(roundMoney('1.005')).toBe('1.01');
    expect(roundMoney('2.675')).toBe('2.68');
  });
  it('rechaza number con decimales', () => {
    expect(() => dec(0.1)).toThrow();
  });
  it('formatea en pesos argentinos', () => {
    expect(formatArs('1234567.5')).toBe('$ 1.234.567,50');
    expect(formatArs('-10')).toBe('-$ 10,00');
  });
});

describe('recargo y margen (ejemplo de la sección 8 del diseño)', () => {
  it('recargo 30% sobre $1.000 da $1.300 y margen real 23,08%', () => {
    expect(priceFromMarkup('1000', '30')).toBe('1300.00');
    expect(marginPercentOf('1000', '1300')).toBe('23.08');
  });
  it('margen 30% sobre $1.000 da $1.428,57 y recargo equivalente 42,86%', () => {
    expect(priceFromMargin('1000', '30')).toBe('1428.57');
    expect(markupPercentOf('1000', '1428.57')).toBe('42.86');
  });
  it('rechaza margen de 100% o más', () => {
    expect(() => priceFromMargin('1000', '100')).toThrow();
  });
  it('redondea precios hacia arriba al múltiplo', () => {
    expect(roundPriceUp('1428.57', 10)).toBe('1430.00');
    expect(roundPriceUp('1300', 50)).toBe('1300.00');
    expect(roundPriceUp('1301', 50)).toBe('1350.00');
    expect(roundPriceUp('99.99', 0)).toBe('99.99');
  });
});
