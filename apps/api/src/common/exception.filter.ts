import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiError } from '@gc/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors';

interface PgLikeError {
  code?: string;
  constraint?: string;
  cause?: PgLikeError;
}

function pgError(err: unknown): PgLikeError | null {
  const e = err as PgLikeError;
  if (e?.code && /^[0-9A-Z]{5}$/.test(e.code)) return e;
  if (e?.cause?.code && /^[0-9A-Z]{5}$/.test(e.cause.code)) return e.cause;
  return null;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_uq: 'Ese email ya está registrado',
  tenants_cuit_active_uq: 'Ya hay un comercio registrado con ese CUIT',
  branches_tenant_name_uq: 'Ya existe una sucursal con ese nombre',
  roles_tenant_name_uq: 'Ya existe un rol con ese nombre',
  memberships_tenant_user_uq: 'Esa persona ya es miembro del comercio',
};

/** Manejo centralizado: todo error sale con el formato { code, message, details, requestId }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = String(request.id);

    let status = 500;
    let body: ApiError = { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado', requestId };

    const pg = pgError(exception);
    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details, requestId };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
        message: status === 404 ? 'Ruta no encontrada' : exception.message,
        requestId,
      };
    } else if (pg?.code === '23505') {
      status = 409;
      const message = (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) || 'Ya existe un registro con esos datos';
      body = { code: 'DUPLICATE', message, details: { constraint: pg.constraint }, requestId };
    } else if (pg?.code === '23503' || pg?.code === '42501') {
      // FK compuesta (tenant_id, id) o política RLS: un ID de otro comercio se ve como inexistente.
      status = 404;
      body = { code: 'NOT_FOUND', message: 'Recurso no encontrado', requestId };
      this.logger.warn(`Acceso a recurso inexistente o ajeno (${pg.code} ${pg.constraint ?? ''}) req=${requestId}`);
    }

    if (status >= 500) {
      this.logger.error(`req=${requestId} ${request.method} ${request.url}`, (exception as Error)?.stack ?? String(exception));
    }
    void reply.status(status).send(body);
  }
}
