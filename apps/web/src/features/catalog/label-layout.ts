/**
 * Medidas de impresión de etiquetas (ADR 0028). Todo en milímetros.
 *
 * - Rollo (impresora térmica): cada «página» es una fila del rollo, con 1 a 4 etiquetas de ancho.
 * - Hoja (A4 o Carta autoadhesiva): columnas × filas con márgenes y separaciones; se llena una
 *   hoja con distintos artículos antes de pasar a la siguiente.
 */
export type Medium = 'roll' | 'sheet';
export type Paper = 'A4' | 'Letter';

export interface LabelLayout {
  medium: Medium;
  paper: Paper;
  /** Medida de cada etiqueta. */
  width: number;
  height: number;
  columns: number;
  /** Filas por hoja; en rollo siempre 1. */
  rows: number;
  marginTop: number;
  marginLeft: number;
  /** Separación entre columnas y entre filas. */
  gapX: number;
  gapY: number;
}

export interface LabelContent {
  showStore: boolean;
  showPrice: boolean;
  showCashPrice: boolean;
  /** Contorno de cada etiqueta, para probar la alineación en una hoja común. */
  outline: boolean;
}

export interface LabelSettings {
  preset: string;
  layout: LabelLayout;
  content: LabelContent;
  /** Corrimiento para calibrar la impresora (positivo: a la derecha y hacia abajo). */
  offsetX: number;
  offsetY: number;
}

const roll = (width: number, height: number, columns = 1, gapX = 0, marginLeft = 0): LabelLayout => ({
  medium: 'roll', paper: 'A4', width, height, columns, rows: 1, marginTop: 0, marginLeft, gapX, gapY: 0,
});
const sheet = (paper: Paper, columns: number, rows: number, width: number, height: number, marginTop = 0, marginLeft = 0, gapX = 0, gapY = 0): LabelLayout => ({
  medium: 'sheet', paper, width, height, columns, rows, marginTop, marginLeft, gapX, gapY,
});

/** Formatos comunes. Las medidas son las que vienen impresas en el paquete de etiquetas. */
export const PRESETS: Array<{ id: string; label: string; layout: LabelLayout }> = [
  { id: 'roll-50x25', label: 'Rollo 50 × 25 mm', layout: roll(50, 25) },
  { id: 'roll-40x30', label: 'Rollo 40 × 30 mm', layout: roll(40, 30) },
  { id: 'roll-60x40', label: 'Rollo 60 × 40 mm', layout: roll(60, 40) },
  { id: 'roll-30x20', label: 'Rollo 30 × 20 mm', layout: roll(30, 20) },
  { id: 'roll-2x40x25', label: 'Rollo de 2 columnas, 40 × 25 mm', layout: roll(40, 25, 2, 3, 1.5) },
  { id: 'roll-3x30x20', label: 'Rollo de 3 columnas, 30 × 20 mm', layout: roll(30, 20, 3, 2, 1) },
  { id: 'a4-24', label: 'A4 · 24 por hoja (3 × 8) · 70 × 37 mm', layout: sheet('A4', 3, 8, 70, 37.1) },
  { id: 'a4-21', label: 'A4 · 21 por hoja (3 × 7) · 63,5 × 38,1 mm', layout: sheet('A4', 3, 7, 63.5, 38.1, 15.15, 7.2, 2.5) },
  { id: 'a4-40', label: 'A4 · 40 por hoja (4 × 10) · 52,5 × 29,7 mm', layout: sheet('A4', 4, 10, 52.5, 29.7) },
  { id: 'a4-65', label: 'A4 · 65 por hoja (5 × 13) · 38,1 × 21,2 mm', layout: sheet('A4', 5, 13, 38.1, 21.2, 10.7, 4.65, 2.5) },
  { id: 'a4-14', label: 'A4 · 14 por hoja (2 × 7) · 99,1 × 38,1 mm', layout: sheet('A4', 2, 7, 99.1, 38.1, 15.15, 4.65, 2.5) },
  { id: 'letter-30', label: 'Carta · 30 por hoja (3 × 10) · 66,7 × 25,4 mm', layout: sheet('Letter', 3, 10, 66.7, 25.4, 12.7, 4.7, 3.1) },
];
export const CUSTOM = 'custom';

export const PAPER_SIZE: Record<Paper, { width: number; height: number; label: string }> = {
  A4: { width: 210, height: 297, label: 'A4 (210 × 297 mm)' },
  Letter: { width: 215.9, height: 279.4, label: 'Carta (216 × 279 mm)' },
};

export const DEFAULT_SETTINGS: LabelSettings = {
  preset: 'roll-50x25',
  layout: PRESETS[0]!.layout,
  content: { showStore: false, showPrice: true, showCashPrice: true, outline: false },
  offsetX: 0,
  offsetY: 0,
};

/** Medida de la página que se le pide al navegador. */
export function pageSize(l: LabelLayout): { width: number; height: number } {
  if (l.medium === 'sheet') return { width: PAPER_SIZE[l.paper].width, height: PAPER_SIZE[l.paper].height };
  return { width: round(l.marginLeft * 2 + l.columns * l.width + (l.columns - 1) * l.gapX), height: l.height };
}

export const perPage = (l: LabelLayout) => l.columns * (l.medium === 'roll' ? 1 : l.rows);

/** Esquina superior izquierda de la etiqueta n° `slot` (desde 0) dentro de la página. */
export function slotPosition(l: LabelLayout, slot: number, offsetX = 0, offsetY = 0): { left: number; top: number } {
  const col = slot % l.columns;
  const row = Math.floor(slot / l.columns);
  return { left: round(l.marginLeft + col * (l.width + l.gapX) + offsetX), top: round(l.marginTop + row * (l.height + l.gapY) + offsetY) };
}

/** Problemas de la configuración, en el orden en que conviene corregirlos; vacío si está bien. */
export function layoutErrors(l: LabelLayout): string[] {
  const errors: string[] = [];
  const nums = [l.width, l.height, l.marginTop, l.marginLeft, l.gapX, l.gapY];
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return ['Revisá las medidas: tienen que ser números positivos'];
  if (l.width < 15 || l.height < 10) errors.push('La etiqueta tiene que medir al menos 15 × 10 mm');
  if (!Number.isInteger(l.columns) || l.columns < 1 || l.columns > (l.medium === 'roll' ? 4 : 10)) errors.push(l.medium === 'roll' ? 'El rollo puede tener de 1 a 4 columnas' : 'La hoja puede tener de 1 a 10 columnas');
  if (l.medium === 'sheet' && (!Number.isInteger(l.rows) || l.rows < 1 || l.rows > 30)) errors.push('La hoja puede tener de 1 a 30 filas');
  if (errors.length) return errors;
  if (l.medium === 'roll') {
    if (pageSize(l).width > 120) errors.push('El rollo no puede medir más de 120 mm de ancho');
    return errors;
  }
  const page = PAPER_SIZE[l.paper];
  const usedW = l.marginLeft + l.columns * l.width + (l.columns - 1) * l.gapX;
  const usedH = l.marginTop + l.rows * l.height + (l.rows - 1) * l.gapY;
  // Medio milímetro de tolerancia: las medidas de los fabricantes vienen redondeadas.
  if (usedW > page.width + 0.5) errors.push(`Las columnas ocupan ${fmt(usedW)} mm y la hoja mide ${fmt(page.width)} mm de ancho`);
  if (usedH > page.height + 0.5) errors.push(`Las filas ocupan ${fmt(usedH)} mm y la hoja mide ${fmt(page.height)} mm de alto`);
  return errors;
}

/**
 * Reparte las etiquetas en páginas. En hoja, `skip` deja libres los primeros lugares de la primera
 * (para aprovechar una hoja ya empezada). Cada página tiene `perPage` lugares; null = vacío.
 */
export function paginate<T>(labels: T[], l: LabelLayout, skip = 0): Array<Array<T | null>> {
  const size = perPage(l);
  const first = l.medium === 'sheet' ? Math.min(Math.max(0, Math.floor(skip)), size - 1) : 0;
  const slots: Array<T | null> = [...Array<null>(first).fill(null), ...labels];
  const pages: Array<Array<T | null>> = [];
  for (let i = 0; i < slots.length; i += size) {
    const page = slots.slice(i, i + size);
    pages.push([...page, ...Array<null>(size - page.length).fill(null)]);
  }
  return labels.length ? pages : [];
}

/** Tamaño de letra relativo a una etiqueta de 50 × 25 mm, acotado para que no quede ilegible ni enorme. */
export const fontScale = (l: Pick<LabelLayout, 'width' | 'height'>) => Math.min(1.8, Math.max(0.7, Math.min(l.width / 50, l.height / 25)));

const STORAGE_KEY = 'gc.labels.settings';

/** La configuración se guarda en cada compu, porque cada una tiene su impresora. */
export function loadSettings(): LabelSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<LabelSettings>;
    const settings: LabelSettings = {
      preset: typeof saved.preset === 'string' ? saved.preset : DEFAULT_SETTINGS.preset,
      layout: { ...DEFAULT_SETTINGS.layout, ...saved.layout },
      content: { ...DEFAULT_SETTINGS.content, ...saved.content },
      offsetX: Number(saved.offsetX) || 0,
      offsetY: Number(saved.offsetY) || 0,
    };
    return layoutErrors(settings.layout).length ? DEFAULT_SETTINGS : settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: LabelSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento (ventana privada): se usa la configuración hasta cerrar la página.
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function fmt(n: number) {
  return round(n).toLocaleString('es-AR');
}
