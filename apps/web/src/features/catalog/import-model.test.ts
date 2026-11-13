import { describe, expect, it } from 'vitest';
import { buildRows, chunkRows, type ImportRow, mapColumns, templateSheets } from './import-model';

describe('importación de productos', () => {
  it('reconoce columnas con otros nombres y propone talle y color como variantes', () => {
    const rows = [
      { n: 1, cells: ['Producto', 'EAN', 'P.V.P. ($)', 'Rubro', 'Talle', 'Color', 'Proveedor'] },
      { n: 3, cells: ['Remera', '779', '1.200', 'Remeras', 'M', 'Rojo', 'Textil SA'] },
    ];
    const { map } = mapColumns(rows)!;
    expect(map.fields).toMatchObject({ name: 0, barcode: 1, price: 2, category: 3 });
    expect(map.extra.map((e) => [e.header, e.asOption])).toEqual([['Talle', true], ['Color', true], ['Proveedor', false]]);
    expect(buildRows(rows, map)).toEqual({
      optionNames: ['Talle', 'Color'],
      rows: [{ row: 3, options: ['M', 'Rojo'], name: 'Remera', barcode: '779', price: '1.200', category: 'Remeras' }],
    });
  });

  it('la planilla modelo se reconoce entera', () => {
    for (const variants of [true, false]) {
      const [products] = templateSheets(variants, ['unit', 'weight']);
      const { map } = mapColumns([{ n: 1, cells: products!.rows[0]!.map(String) }])!;
      expect(map.fields.name).toBe(0);
      expect(map.fields.price).toBeDefined();
      expect(map.extra.map((e) => e.header)).toEqual(variants ? ['Talle', 'Color'] : []);
    }
  });

  it('parte la importación sin separar las variantes de un producto', () => {
    const row = (n: number, name: string): ImportRow => ({ row: n, options: [], name });
    const rows = [row(2, 'A'), row(3, 'B'), row(4, 'B'), row(5, 'b '), row(6, 'C'), row(7, 'A')];
    expect(chunkRows(rows, 3).map((c) => c.map((r) => r.row))).toEqual([[2, 7], [3, 4, 5], [6]]);
  });
});
