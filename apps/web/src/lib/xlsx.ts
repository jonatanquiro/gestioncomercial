/**
 * Lectura y escritura de planillas sin bibliotecas externas. Un .xlsx es un ZIP con XML: se arma
 * y se lee con las APIs del navegador (CompressionStream / DecompressionStream y DOMParser).
 * También lee CSV (con «;» o «,», en UTF-8 o en la codificación de Excel en Windows).
 */

// ------------------------------------------------------------------ ZIP

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const reader = source.pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    parts.push(r.value);
    size += r.value.length;
  }
  const out = new Uint8Array(size);
  let p = 0;
  for (const part of parts) out.set(part, p), (p += part.length);
  return out;
}

/** ZIP con los archivos comprimidos (deflate) si el navegador puede; si no, sin comprimir. */
async function zip(files: Array<{ name: string; data: Uint8Array }>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let method = 0;
    let body = f.data;
    if (typeof CompressionStream !== 'undefined') {
      body = await pipe(f.data, new CompressionStream('deflate-raw'));
      method = 8;
    }
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(12, 0x21, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

async function unzip(buf: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError('El archivo no es una planilla válida o está dañado');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, () => Promise<Uint8Array>>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new SpreadsheetError('El archivo está dañado');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    files.set(name, () => (method === 0 ? Promise.resolve(data) : pipe(data, new DecompressionStream('deflate-raw'))));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ------------------------------------------------------------------ Escritura

export type Cell = string | number | null | undefined;
export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** Ancho de cada columna, en caracteres. */
  widths?: number[];
  /** Columnas (desde 0) con formato texto, para que Excel no convierta los códigos en números. */
  textColumns?: number[];
  /** La primera fila es encabezado: en negrita y fija al desplazarse. */
  header?: boolean;
  /** Celdas de texto largo, con ajuste de línea. */
  wrap?: boolean;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function sheetXml(sheet: SheetSpec): string {
  const text = new Set(sheet.textColumns ?? []);
  const cols = (sheet.widths ?? [])
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${text.has(i) ? ' style="2"' : ''}/>`)
    .join('');
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return '';
          const ref = `${colName(c)}${r + 1}`;
          const style = sheet.header && r === 0 ? 1 : text.has(c) ? 2 : sheet.wrap ? 3 : 0;
          const s = style ? ` s="${style}"` : '';
          if (typeof v === 'number' && !text.has(c)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const pane = sheet.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Arma un .xlsx con las hojas indicadas, listo para descargar. */
export async function writeXlsx(sheets: SheetSpec[]): Promise<Blob> {
  return new Blob([(await xlsxBytes(sheets)) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function xlsxBytes(sheets: SheetSpec[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    {
      name: '[Content_Types].xml',
      xml: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      xml: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      xml: `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', xml: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s) })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
}

// ------------------------------------------------------------------ Lectura

export class SpreadsheetError extends Error {}

/** Fila leída con su número en la planilla (para señalar errores como los ve la persona). */
export interface SheetRow {
  n: number;
  cells: string[];
}

const byLocal = (parent: Document | Element, name: string) => Array.from(parent.getElementsByTagNameNS('*', name));
const parseXml = (bytes: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Texto de un string compartido o en línea, sin la guía fonética (rPh) que agrega Excel en japonés. */
const richText = (el: Element) => byLocal(el, 't').filter((t) => (t.parentNode as Element | null)?.localName !== 'rPh').map((t) => t.textContent ?? '').join('');

async function readXlsx(buf: Uint8Array): Promise<SheetRow[]> {
  const files = await unzip(buf);
  const get = async (name: string) => {
    const f = files.get(name);
    return f ? parseXml(await f()) : null;
  };
  // Primera hoja según el libro (no necesariamente sheet1.xml).
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  const first = workbook ? byLocal(workbook, 'sheet')[0] : undefined;
  const rid = first ? Array.from(first.attributes).find((a) => a.localName === 'id')?.value : undefined;
  const target = rid && rels ? byLocal(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') : undefined;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheet = await get(sheetPath);
  if (!sheet) throw new SpreadsheetError('No encontré ninguna hoja en la planilla');
  const shared = await get('xl/sharedStrings.xml');
  const strings = shared ? byLocal(shared, 'si').map(richText) : [];

  const rows: SheetRow[] = [];
  byLocal(sheet, 'row').forEach((row, i) => {
    const n = Number(row.getAttribute('r')) || i + 1;
    const cells: string[] = [];
    byLocal(row, 'c').forEach((c, j) => {
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : j;
      const type = c.getAttribute('t');
      const v = byLocal(c, 'v')[0]?.textContent ?? '';
      cells[col] = type === 's' ? (strings[Number(v)] ?? '') : type === 'inlineStr' ? richText(c) : type === 'b' ? (v === '1' ? 'VERDADERO' : 'FALSO') : v;
    });
    rows.push({ n, cells: Array.from(cells, (x) => (x ?? '').trim()) });
  });
  return rows;
}

function readCsv(buf: Uint8Array): SheetRow[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: SheetRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) cells.push(cell.trim()), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell.trim());
      rows.push({ n: n++, cells });
      cells = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || cells.length > 0) rows.push({ n, cells: [...cells, cell.trim()] });
  return rows;
}

/** Lee la primera hoja de un .xlsx o un .csv. Las filas vacías se descartan. */
export async function readSpreadsheet(file: Blob & { name?: string }): Promise<SheetRow[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let rows: SheetRow[];
  if (buf[0] === 0x50 && buf[1] === 0x4b) rows = await readXlsx(buf);
  else if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new SpreadsheetError('Es un Excel viejo (.xls). Abrilo y guardalo como «Libro de Excel (.xlsx)» o como CSV.');
  else if (/\.(xlsx|xlsm|ods|numbers|pdf)$/i.test(file.name ?? '')) throw new SpreadsheetError('No pude leer el archivo: subí un .xlsx o un .csv');
  else rows = readCsv(buf);
  return rows.filter((r) => r.cells.some((c) => c !== ''));
}
