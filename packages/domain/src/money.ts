import Decimal from 'decimal.js';

/**
 * Aritmética monetaria sin punto flotante. Todos los importes viajan como string
 * decimal ("1234.50") entre capas y se operan con Decimal.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = string | number | Decimal;

export function dec(value: DecimalInput): Decimal {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error('Usá strings para importes con decimales, no number');
  }
  return new D(value);
}

/** Redondea a 2 decimales con criterio half-up (comprobantes). */
export function roundMoney(value: DecimalInput): string {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Redondea a 4 decimales (costos unitarios y precios intermedios). */
export function roundUnit(value: DecimalInput): string {
  return dec(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export function sumMoney(values: DecimalInput[]): string {
  return roundMoney(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), dec(0)));
}

/** Formato para mostrar: $ 1.234,50 */
export function formatArs(value: DecimalInput): string {
  const [int, frac] = roundMoney(value).split('.') as [string, string];
  const negative = int.startsWith('-');
  const digits = negative ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}$ ${grouped},${frac}`;
}
