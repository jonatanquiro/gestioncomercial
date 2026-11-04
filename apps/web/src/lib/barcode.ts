/**
 * Codificación de códigos de barras para imprimir etiquetas: EAN-13 (códigos de fábrica y los
 * internos con prefijo 29) y Code 128 B para cualquier otro texto, como un código interno con letras.
 * Devuelve los módulos como texto: «1» barra, «0» espacio, todos del mismo ancho.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = L.map((p) => p.replace(/./g, (b) => (b === '0' ? '1' : '0')));
/** Paridad de los 6 dígitos de la izquierda según el primero. */
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(twelve: string): number {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** 95 módulos: guarda, 6 dígitos, guarda central, 6 dígitos, guarda. null si no es un EAN-13 válido. */
export function ean13Modules(code: string): string | null {
  if (!isEan13(code)) return null;
  const d = [...code].map(Number);
  const parity = PARITY[d[0]!]!;
  const left = d.slice(1, 7).map((n, i) => (parity[i] === 'L' ? L : G)[n]).join('');
  const right = d.slice(7).map((n) => R[n]).join('');
  return `101${left}01010${right}101`;
}

/** Anchos de barra y espacio de cada valor de Code 128 (0 a 106, este último el de parada). */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

const widthsToModules = (widths: string) => [...widths].map((w, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(w))).join('');

/** Code 128 juego B: letras, números y símbolos imprimibles. null si hay caracteres fuera de ese juego. */
export function code128Modules(text: string): string | null {
  if (text === '' || ![...text].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)) return null;
  const values = [...text].map((c) => c.charCodeAt(0) - 32);
  const check = (START_B + values.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [START_B, ...values, check, STOP].map((v) => widthsToModules(CODE128[v]!)).join('');
}

/** Módulos del código: EAN-13 si lo es, si no Code 128. */
export function barcodeModules(code: string): { kind: 'ean13' | 'code128'; modules: string } | null {
  const ean = ean13Modules(code);
  if (ean) return { kind: 'ean13', modules: ean };
  const c128 = code128Modules(code);
  return c128 ? { kind: 'code128', modules: c128 } : null;
}
