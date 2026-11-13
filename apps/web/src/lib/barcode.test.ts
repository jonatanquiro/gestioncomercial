import { describe, expect, it } from 'vitest';
import { barcodeModules, code128Modules, ean13CheckDigit, ean13Modules, isEan13 } from './barcode';

describe('EAN-13', () => {
  it('calcula el dígito verificador', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isEan13('4006381333931')).toBe(true);
    expect(isEan13('4006381333932')).toBe(false);
    expect(isEan13('29000000000')).toBe(false);
  });

  it('codifica con la paridad que marca el primer dígito', () => {
    // 4 → paridad LGLLGG para 006381; 333931 con el juego R.
    const left = ['0001101', '0100111', '0101111', '0111101', '0001001', '0110011'].join('');
    const right = ['1000010', '1000010', '1000010', '1110100', '1000010', '1100110'].join('');
    expect(ean13Modules('4006381333931')).toBe(`101${left}01010${right}101`);
    expect(ean13Modules('4006381333931')).toHaveLength(95);
  });
});

describe('Code 128', () => {
  it('arranca con el inicio B, termina con la parada y cada símbolo mide 11 módulos', () => {
    const m = code128Modules('REM-M-01')!;
    expect(m.startsWith('11010010000')).toBe(true);
    expect(m.endsWith('1100011101011')).toBe(true);
    // inicio + 8 caracteres + verificador = 10 símbolos de 11, más la parada de 13.
    expect(m).toHaveLength(10 * 11 + 13);
  });

  it('rechaza lo que no se puede codificar', () => {
    expect(code128Modules('')).toBeNull();
    expect(code128Modules('ñandú')).toBeNull();
  });

  it('elige EAN-13 cuando corresponde', () => {
    expect(barcodeModules('2900000000018')?.kind).toBe('ean13');
    expect(barcodeModules('ALF-3')?.kind).toBe('code128');
  });
});
