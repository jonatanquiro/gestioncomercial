/** Valida un CUIT/CUIL argentino (11 dígitos con dígito verificador módulo 11). */
export function isValidCuit(raw: string): boolean {
  const digits = raw.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(digits[10]);
}

export function normalizeCuit(raw: string): string {
  return raw.replace(/[-\s]/g, '');
}
