const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));

export function formatCuit(cuit: string | null | undefined) {
  if (!cuit || cuit.length !== 11) return cuit ?? '';
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

export const TENANT_STATUS_LABELS: Record<string, string> = {
  trial: 'Prueba',
  active: 'Activo',
  past_due: 'Pago vencido',
  suspended: 'Suspendido',
  cancelled: 'Dado de baja',
};

const UNIT_SUFFIX: Record<string, string> = { unit: '', weight: ' kg', length: ' m', volume: ' l' };

/** Cantidad para mostrar: "12" para unidades, "1,250 kg" para peso. */
export function formatQty(value: string | null | undefined, saleMode = 'unit') {
  if (value === null || value === undefined) return '—';
  const [int = '0', frac = ''] = value.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const negative = int.startsWith('-');
  const digits = negative ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${trimmed ? `,${trimmed}` : ''}${UNIT_SUFFIX[saleMode] ?? ''}`;
}

/** Porcentaje "23.08" → "23,08 %". */
export const formatPercent = (value: string | null | undefined) => (value === null || value === undefined ? '—' : `${value.replace('.', ',')} %`);

/**
 * Convierte lo que se tipea al texto decimal que espera la API: "1.250,50" → "1250.50",
 * "1250,5" → "1250.5", "1.250" → "1250" (punto de miles) y "1.25" → "1.25".
 */
export function parseDecimalInput(value: string) {
  const v = value.trim().replace(/\s/g, '').replace(/^\$/, '');
  if (v.includes(',')) return v.replace(/\./g, '').replace(',', '.');
  if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) return v.replace(/\./g, '');
  return v;
}

/** Texto de la API para un campo editable: "1250.50" → "1250,50", "12.000" → "12". */
export function toInputDecimal(value: string | null | undefined) {
  if (value === null || value === undefined) return '';
  const [int = '0', frac = ''] = value.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${int},${trimmed}` : int;
}
