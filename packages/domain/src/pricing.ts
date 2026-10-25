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

/** Precio aumentado (o bajado, con signo negativo) un porcentaje: P × (1 + p). */
export function priceFromPercent(price: DecimalInput, percent: DecimalInput): string {
  return roundMoney(dec(price).times(dec(1).plus(dec(percent).div(100))));
}

/** Precio más (o menos) un monto fijo. */
export function priceFromFixed(price: DecimalInput, amount: DecimalInput): string {
  return roundMoney(dec(price).plus(dec(amount)));
}

/** Variación porcentual entre dos precios: (nuevo − anterior) / anterior. */
export function variationPercent(oldPrice: DecimalInput, newPrice: DecimalInput): string {
  const o = dec(oldPrice);
  if (o.isZero()) throw new Error('Precio anterior cero: la variación no está definida');
  return dec(newPrice).minus(o).div(o).times(100).toDecimalPlaces(2).toFixed(2);
}

/**
 * Importes de una línea de venta: bruto = cantidad × precio (redondeado), descuento sobre el
 * bruto (redondeado) y total = bruto − descuento. El total de la venta es la suma de líneas.
 */
export function saleLine(quantity: DecimalInput, unitPrice: DecimalInput, discountPercent: DecimalInput = '0') {
  const gross = roundMoney(dec(quantity).times(dec(unitPrice)));
  const discount = roundMoney(dec(gross).times(dec(discountPercent)).div(100));
  return { gross, discount, total: roundMoney(dec(gross).minus(dec(discount))) };
}

export const lineGross = (quantity: DecimalInput, unitPrice: DecimalInput) => saleLine(quantity, unitPrice).gross;
export const lineDiscount = (quantity: DecimalInput, unitPrice: DecimalInput, discountPercent: DecimalInput) => saleLine(quantity, unitPrice, discountPercent).discount;
export const lineTotal = (quantity: DecimalInput, unitPrice: DecimalInput, discountPercent: DecimalInput) => saleLine(quantity, unitPrice, discountPercent).total;

/** Parte proporcional de un importe al devolver una cantidad: importe × devuelta / vendida. */
export function proportionalAmount(amount: DecimalInput, part: DecimalInput, whole: DecimalInput): string {
  return roundMoney(dec(amount).times(dec(part)).div(dec(whole)));
}
