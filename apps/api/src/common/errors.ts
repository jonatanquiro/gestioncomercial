import { HttpStatus } from '@nestjs/common';

/** Error de dominio con código estable para el cliente. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  validation: (details: unknown) => new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Hay datos inválidos', details),
  unauthenticated: () => new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Iniciá sesión para continuar'),
  invalidCredentials: () => new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos'),
  forbidden: (permission?: string) =>
    new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'No tenés permiso para realizar esta acción', permission ? { permission } : undefined),
  csrf: () => new AppError(HttpStatus.FORBIDDEN, 'CSRF_INVALID', 'La sesión expiró o la solicitud no es válida. Recargá la página.'),
  noTenant: () => new AppError(HttpStatus.FORBIDDEN, 'NO_ACTIVE_TENANT', 'No tenés un comercio activo seleccionado'),
  tenantSuspended: () =>
    new AppError(HttpStatus.FORBIDDEN, 'TENANT_SUSPENDED', 'El comercio está suspendido. Comunicate con soporte.'),
  notFound: (what = 'Recurso') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} no encontrado`),
  conflict: (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message),
  planLimit: (limit: string, value: number) =>
    new AppError(HttpStatus.PAYMENT_REQUIRED, 'PLAN_LIMIT_REACHED', 'Alcanzaste el límite de tu plan', { limit, value }),
  tooManyRequests: () =>
    new AppError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS', 'Demasiados intentos. Esperá unos minutos.'),
  badRequest: (code: string, message: string) => new AppError(HttpStatus.BAD_REQUEST, code, message),
};
