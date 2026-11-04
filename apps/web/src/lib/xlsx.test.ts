import { describe, expect, it } from 'vitest';
import { readSpreadsheet, SpreadsheetError, xlsxBytes } from './xlsx';

const asFile = (bytes: Uint8Array, name: string) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as unknown as File;

describe('planillas', () => {
  it('lo que se escribe en .xlsx se vuelve a leer igual, desde la primera hoja', async () => {
    const bytes = await xlsxBytes([
      { name: 'Productos', header: true, textColumns: [1], rows: [['Nombre *', 'Código de barras', 'Precio *'], ['Alfajor «triple» & co', '0779123', 1250.5], [], ['Queso', null, 9800]] },
      { name: 'Instrucciones', rows: [['Otra hoja']] },
    ]);
    const rows = await readSpreadsheet(asFile(bytes, 'modelo.xlsx'));
    expect(rows).toEqual([
      { n: 1, cells: ['Nombre *', 'Código de barras', 'Precio *'] },
      { n: 2, cells: ['Alfajor «triple» & co', '0779123', '1250.5'] },
      { n: 4, cells: ['Queso', '', '9800'] },
    ]);
  });

  it('lee CSV con punto y coma, comillas y la codificación de Excel en Windows', async () => {
    const latin1 = Uint8Array.from([...'Nombre;Precio\r\n"Caf', 0xe9, ...' ""molido""";1.250,50\r\n'].map((c) => (typeof c === 'number' ? c : c.charCodeAt(0))));
    expect(await readSpreadsheet(asFile(latin1, 'lista.csv'))).toEqual([
      { n: 1, cells: ['Nombre', 'Precio'] },
      { n: 2, cells: ['Café "molido"', '1.250,50'] },
    ]);
  });

  it('avisa si es un Excel viejo', async () => {
    await expect(readSpreadsheet(asFile(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]), 'viejo.xls'))).rejects.toBeInstanceOf(SpreadsheetError);
  });
});
