import { dec, roundMoney, type DecimalInput } from './money';

/** Precio con recargo porcentual sobre el costo: P = C × (1 + r). */
export function priceFromMarkup(cost: DecimalInput, markupPercent: DecimalInput): string {
  return roundMoney(dec(cost).times(dec(1).plus(dec(markupPercent).div(100))));
}

/** Precio con margen porcentual sobre el precio de venta: P = C / (1 − m). */
export function priceFromMargin(cost: DecimalInput, marginPercent: DecimalInput): string {
  const m = dec(marginPercent).div(100);
  if (m.gte(1)) throw new Error('El margen debe ser menor a 100%');
  return roundMoney(dec(cost).div(dec(1).minus(m)));
}

/** Recargo equivalente: (P − C) / C. */
export function markupPercentOf(cost: DecimalInput, price: DecimalInput): string {
  const c = dec(cost);
  if (c.isZero()) throw new Error('Costo cero: el recargo no está definido');
  return dec(price).minus(c).div(c).times(100).toDecimalPlaces(2).toFixed(2);
}

/** Margen equivalente: (P − C) / P. */
export function marginPercentOf(cost: DecimalInput, price: DecimalInput): string {
  const p = dec(price);
  if (p.isZero()) throw new Error('Precio cero: el margen no está definido');
  return p.minus(dec(cost)).div(p).times(100).toDecimalPlaces(2).toFixed(2);
}

/** Redondea un precio hacia arriba al múltiplo indicado (0 = sin redondeo). */
export function roundPriceUp(price: DecimalInput, step: number): string {
  if (step <= 0) return roundMoney(price);
  const s = dec(step);
  return roundMoney(dec(price).div(s).ceil().times(s));
}
