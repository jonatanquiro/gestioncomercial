import { describe, expect, it } from 'vitest';
import { whatsappNumber } from './send-receipt';

describe('whatsappNumber', () => {
  it('arma 549 + característica + número sin 0 ni 15', () => {
    expect(whatsappNumber('03492 15-567666')).toBe('5493492567666');
    expect(whatsappNumber('11 15 2345-6789')).toBe('5491123456789');
    expect(whatsappNumber('3492 567666')).toBe('5493492567666');
    expect(whatsappNumber('+54 9 11 2345 6789')).toBe('5491123456789');
  });
  it('sin número deja que WhatsApp elija el contacto', () => {
    expect(whatsappNumber('  ')).toBe('');
  });
});
