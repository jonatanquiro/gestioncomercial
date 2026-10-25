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
