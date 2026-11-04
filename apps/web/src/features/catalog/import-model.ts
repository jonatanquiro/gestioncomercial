import { BUSINESS_TYPES, type TenantDto } from '@gc/contracts';
import type { Cell, SheetRow, SheetSpec } from '@/lib/xlsx';

/** Campos que entiende la importación (ADR 0022), en el orden de la planilla modelo. */
export const IMPORT_FIELDS = ['name', 'barcode', 'sku', 'price', 'cost', 'initialStock', 'minStock', 'category', 'brand', 'vatRate', 'saleMode', 'description'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const HEADERS: Record<ImportField, string> = {
  name: 'Nombre *',
  barcode: 'Código de barras',
  sku: 'Código interno',
  price: 'Precio *',
  cost: 'Costo',
  initialStock: 'Stock inicial',
  minStock: 'Stock mínimo',
  category: 'Categoría',
  brand: 'Marca',
  vatRate: 'IVA',
  saleMode: 'Se vende por',
  description: 'Descripción',
};

/** Nombres con los que se reconoce cada columna, ya normalizados (minúsculas, sin acentos ni signos). */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['nombre', 'producto', 'articulo', 'nombre del producto', 'nombre del articulo', 'descripcion del producto'],
  barcode: ['codigo de barras', 'codigo barras', 'cod barras', 'cod de barras', 'ean', 'ean13', 'codigo', 'barcode', 'codigo ean'],
  sku: ['codigo interno', 'cod interno', 'sku', 'codigo propio', 'referencia'],
  price: ['precio', 'precio de venta', 'precio venta', 'pvp', 'precio final', 'precio al publico', 'venta'],
  cost: ['costo', 'precio de costo', 'precio costo', 'costo unitario', 'compra', 'precio de compra'],
  initialStock: ['stock', 'stock inicial', 'cantidad', 'existencia', 'stock actual'],
  minStock: ['stock minimo', 'minimo'],
  category: ['categoria', 'rubro', 'familia', 'seccion'],
  brand: ['marca'],
  vatRate: ['iva', 'alicuota', 'alicuota iva', 'alicuota de iva', 'tasa iva'],
  saleMode: ['se vende por', 'unidad de venta', 'venta por', 'unidad de medida', 'unidad'],
  description: ['descripcion', 'detalle', 'observaciones'],
};

/** Columnas desconocidas que se proponen como propiedades de variantes. */
const LIKELY_OPTIONS = ['talle', 'talla', 'color', 'tamano', 'medida', 'sabor', 'numero', 'modelo', 'aroma', 'capacidad', 'peso', 'material'];

export const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[*.%:#$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** ¿La planilla modelo lleva talles y colores? Si el plan los incluye y el rubro los usa. */
export function usesVariants(tenant: TenantDto): boolean {
  const type = BUSINESS_TYPES.find((t) => t.code === tenant.businessTypeCode);
  return !!tenant.plan?.features.includes('variants') && !!type?.recommendedFeatures.includes('variants');
}

/** Formas de venta del rubro: con peso o medida, la planilla suma la columna «Se vende por». */
export const businessSaleModes = (tenant: TenantDto): string[] => BUSINESS_TYPES.find((t) => t.code === tenant.businessTypeCode)?.defaultSettings.saleModes ?? ['unit'];

/** Planilla modelo: «Productos» vacía para completar, un ejemplo según el rubro e instrucciones. */
export function templateSheets(withVariants: boolean, saleModes: string[]): SheetSpec[] {
  const options = withVariants ? ['Talle', 'Color'] : [];
  const fields: ImportField[] = withVariants
    ? ['name', 'barcode', 'sku', 'price', 'cost', 'initialStock', 'minStock', 'category', 'brand', 'vatRate', 'description']
    : saleModes.length > 1
      ? [...IMPORT_FIELDS]
      : IMPORT_FIELDS.filter((f) => f !== 'saleMode');
  const header = [fields[0]!, ...options, ...fields.slice(1)];
  const titles = header.map((h) => (h in HEADERS ? HEADERS[h as ImportField] : h));
  const widths = header.map((h) => (h === 'name' || h === 'description' ? 34 : h === 'barcode' ? 18 : 14));
  const textColumns = header.map((h, i) => (h === 'barcode' || h === 'sku' ? i : -1)).filter((i) => i >= 0);
  const row = (values: Partial<Record<string, Cell>>) => header.map((h) => values[h] ?? null);
  const example = withVariants
    ? [
        row({ name: 'Remera lisa algodón', Talle: 'S', Color: 'Blanco', barcode: '2900000000017', price: 12000, cost: 6500, initialStock: 4, minStock: 2, category: 'Remeras', vatRate: '21' }),
        row({ name: 'Remera lisa algodón', Talle: 'M', Color: 'Blanco', barcode: '2900000000024', price: 12000, cost: 6500, initialStock: 6 }),
        row({ name: 'Remera lisa algodón', Talle: 'L', Color: 'Negro', price: 12500, cost: 6500, initialStock: 3 }),
        row({ name: 'Jean recto', Talle: '40', Color: 'Azul', sku: 'JR-40', price: 38000, cost: 21000, initialStock: 2, category: 'Pantalones', brand: 'Marca propia' }),
        row({ name: 'Jean recto', Talle: '42', Color: 'Azul', sku: 'JR-42', price: 38000, cost: 21000, initialStock: 2 }),
        row({ name: 'Cinturón de cuero', price: 15000, cost: 7000, initialStock: 5, category: 'Accesorios' }),
      ]
    : [
        row({ name: 'Alfajor triple chocolate', barcode: '7790000000012', price: 1200, cost: 750, initialStock: 24, minStock: 6, category: 'Golosinas', vatRate: '21' }),
        row({ name: 'Gaseosa cola 500 ml', barcode: '7790000000029', price: 1800, cost: 1100, initialStock: 12, category: 'Bebidas' }),
        row({ name: 'Cargador de celular', sku: 'CARG-01', price: 9500, cost: 5000, initialStock: 3, category: 'Varios', description: 'USB-C, 20 W' }),
        ...(saleModes.length > 1 ? [row({ name: 'Queso cremoso', price: 9800, cost: 6200, initialStock: 4.5, category: 'Fiambrería', vatRate: '10,5', saleMode: 'kg' })] : []),
      ];
  const help: Cell[][] = [
    ['Cómo completar la planilla'],
    [''],
    ['Completá la hoja «Productos»: una fila por artículo. La hoja «Ejemplo» muestra cómo queda.'],
    ['Solo son obligatorios el Nombre y el Precio. Las demás columnas se pueden dejar vacías o borrar.'],
    ...(withVariants
      ? [
          ['Talles y colores: una fila por cada combinación, repitiendo el mismo Nombre. Las filas con el mismo nombre forman un producto con sus variantes.'],
          ['Podés cambiar «Talle» o «Color» por otra propiedad (Número, Sabor, Medida…) o agregar una tercera columna. Si un producto no tiene variantes, dejalas vacías.'],
        ]
      : [['Cada nombre tiene que aparecer una sola vez.']]),
    ['Código de barras: el que trae el artículo. Si un código ya está cargado en el sistema, se puede actualizar su precio y costo en lugar de crear otro.'],
    ['Precio y Costo: con o sin $, con coma o punto para los decimales (1.250,50 o 1250.50).'],
    ['Stock inicial: lo que hay hoy en el depósito principal. En artículos que ya existen no se toca: para sumar mercadería usá Compras.'],
    ['Categoría y Marca: si no existen, se crean al importar.'],
    ['IVA: 21, 10,5, 27, 5, 2,5, 0, exento o no gravado. Vacío: 21.'],
    ...(saleModes.length > 1 ? [['Se vende por: unidad, kg, metro o litro. Vacío: unidad.']] : []),
    ['También sirve un CSV o la lista de otro sistema: se reconocen columnas como «Producto», «EAN», «PVP» o «Rubro».'],
    ['Antes de importar se muestra una vista previa con los errores por número de fila: no se carga nada hasta que lo confirmes.'],
  ];
  return [
    { name: 'Productos', header: true, rows: [titles], widths, textColumns },
    { name: 'Ejemplo', header: true, rows: [titles, ...example], widths, textColumns },
    { name: 'Instrucciones', rows: help, widths: [120], wrap: true },
  ];
}

export interface ColumnMap {
  /** Índice de columna de cada campo reconocido. */
  fields: Partial<Record<ImportField, number>>;
  /** Columnas no reconocidas, con su encabezado y si se usan como propiedad de variantes. */
  extra: Array<{ index: number; header: string; asOption: boolean }>;
}

/** Encuentra la fila de encabezados (la primera con datos) y reconoce cada columna. */
export function mapColumns(rows: SheetRow[], variantsAllowed = true): { header: SheetRow; map: ColumnMap } | null {
  const header = rows[0];
  if (!header) return null;
  const fields: ColumnMap['fields'] = {};
  const extra: ColumnMap['extra'] = [];
  header.cells.forEach((raw, index) => {
    const key = normalizeHeader(raw);
    if (!key) return;
    const field = IMPORT_FIELDS.find((f) => SYNONYMS[f].includes(key));
    if (field && fields[field] === undefined) fields[field] = index;
    else extra.push({ index, header: raw.replace(/\s*\*$/, '').trim(), asOption: variantsAllowed && LIKELY_OPTIONS.includes(key) });
  });
  // Hasta tres propiedades, como en el alta de productos.
  let options = 0;
  for (const e of extra) if (e.asOption && ++options > 3) e.asOption = false;
  return { header, map: { fields, extra } };
}

export interface ImportRow {
  row: number;
  options: string[];
  [field: string]: string | number | string[];
}

/** Filas para el servidor: cada campo como texto, tal cual la celda; el servidor interpreta los números. */
export function buildRows(rows: SheetRow[], map: ColumnMap): { optionNames: string[]; rows: ImportRow[] } {
  const optionCols = map.extra.filter((e) => e.asOption);
  return {
    optionNames: optionCols.map((e) => e.header),
    rows: rows.slice(1).map((r) => {
      const out: ImportRow = { row: r.n, options: optionCols.map((e) => r.cells[e.index] ?? '') };
      for (const f of IMPORT_FIELDS) {
        const i = map.fields[f];
        if (i !== undefined) out[f] = r.cells[i] ?? '';
      }
      return out;
    }),
  };
}

/**
 * Partes de la importación para que cada pedido termine rápido en el hosting: hasta `size`
 * filas, sin separar las filas de un mismo producto (mismo nombre = variantes).
 */
export function chunkRows(rows: ImportRow[], size = 300): ImportRow[][] {
  const groups = new Map<string, ImportRow[]>();
  for (const r of rows) {
    const key = String(r.name ?? '').trim().toLowerCase() || `#${r.row}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const chunks: ImportRow[][] = [];
  let current: ImportRow[] = [];
  for (const g of groups.values()) {
    if (current.length > 0 && current.length + g.length > size) chunks.push(current), (current = []);
    current.push(...g);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
