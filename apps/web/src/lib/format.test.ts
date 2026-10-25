import { describe, expect, it } from 'vitest';
import { formatQty, parseDecimalInput, toInputDecimal } from './format';

describe('cantidades e importes tipeados', () => {
  it('entiende coma decimal y punto de miles', () => {
    expect(parseDecimalInput('1.250,50')).toBe('1250.50');
    expect(parseDecimalInput('1250,5')).toBe('1250.5');
    expect(parseDecimalInput('1.250')).toBe('1250');
    expect(parseDecimalInput('12.500.000')).toBe('12500000');
    expect(parseDecimalInput('1.25')).toBe('1.25');
    expect(parseDecimalInput(' $ 990 ')).toBe('990');
    expect(parseDecimalInput('-3')).toBe('-3');
  });
  it('muestra cantidades sin ceros de más', () => {
    expect(formatQty('12.000')).toBe('12');
    expect(formatQty('1250.500', 'weight')).toBe('1.250,5 kg');
    expect(formatQty('-2.000')).toBe('-2');
    expect(toInputDecimal('1250.50')).toBe('1250,5');
    expect(toInputDecimal('12.000')).toBe('12');
    expect(toInputDecimal(null)).toBe('');
  });
});
