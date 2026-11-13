import { describe, expect, it } from 'vitest';
import { PRESETS, layoutErrors, pageSize, paginate, perPage, slotPosition } from './label-layout';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.layout;

describe('medidas de etiquetas', () => {
  it('todos los formatos predefinidos entran en su papel', () => {
    for (const p of PRESETS) expect(layoutErrors(p.layout), p.label).toEqual([]);
  });

  it('en rollo la página es una fila: ancho de las columnas más bordes y separaciones', () => {
    expect(pageSize(preset('roll-50x25'))).toEqual({ width: 50, height: 25 });
    expect(pageSize(preset('roll-2x40x25'))).toEqual({ width: 86, height: 25 });
    expect(perPage(preset('roll-2x40x25'))).toBe(2);
  });

  it('en hoja ubica cada etiqueta con márgenes, separaciones y calibración', () => {
    const l = preset('a4-21');
    expect(pageSize(l)).toEqual({ width: 210, height: 297 });
    expect(perPage(l)).toBe(21);
    expect(slotPosition(l, 0)).toEqual({ left: 7.2, top: 15.15 });
    expect(slotPosition(l, 4)).toEqual({ left: 73.2, top: 53.25 });
    expect(slotPosition(l, 0, -1, 0.5)).toEqual({ left: 6.2, top: 15.65 });
  });

  it('llena la hoja con distintos artículos y respeta los lugares ya usados', () => {
    const l = preset('a4-24');
    const items = Array.from({ length: 30 }, (_, i) => i);
    const pages = paginate(items, l, 5);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.slice(0, 6)).toEqual([null, null, null, null, null, 0]);
    expect(pages[0]![23]).toBe(18);
    expect(pages[1]!.filter((x) => x !== null)).toHaveLength(11);
    // En rollo no hay lugares salteados.
    expect(paginate([1, 2, 3], preset('roll-2x40x25'), 5)).toEqual([[1, 2], [3, null]]);
    expect(paginate([], l)).toEqual([]);
  });

  it('avisa cuando las etiquetas no entran en la hoja', () => {
    expect(layoutErrors({ ...preset('a4-24'), columns: 4 })[0]).toMatch(/Las columnas ocupan 280 mm/);
    expect(layoutErrors({ ...preset('a4-24'), rows: 9 })[0]).toMatch(/Las filas ocupan/);
    expect(layoutErrors({ ...preset('roll-50x25'), width: 10 })[0]).toMatch(/al menos 15 × 10/);
    expect(layoutErrors({ ...preset('roll-50x25'), columns: 5 })[0]).toMatch(/de 1 a 4 columnas/);
  });
});
