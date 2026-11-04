/**
 * Ticket de cambio: lleva un código de barras con el número de venta («V» y el número) para
 * encontrarla escaneándolo, y el plazo para cambiar según la configuración del comercio.
 */

export const saleTicketCode = (number: number) => `V${number}`;

/** Número de venta de un código de ticket de cambio («V123», «v123»); null si no lo es. */
export function parseSaleTicketCode(text: string): number | null {
  const m = /^v0*(\d{1,12})$/i.exec(text.trim());
  return m ? Number(m[1]) : null;
}

/** Último día para cambiar: el día de la venta más el plazo. null si el comercio no tiene plazo. */
export function exchangeDeadline(confirmedAt: string, days: number | undefined): Date | null {
  if (!days) return null;
  const d = new Date(confirmedAt);
  d.setHours(23, 59, 59, 999);
  d.setDate(d.getDate() + days);
  return d;
}
