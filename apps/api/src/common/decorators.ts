import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@gc/contracts';
import type { FastifyRequest } from 'fastify';
import type { Actor, PlatformActor } from './actor';

export const PUBLIC_KEY = 'gc:public';
export const PLATFORM_KEY = 'gc:platform';
export const PERMISSION_KEY = 'gc:permission';
export const NO_TENANT_KEY = 'gc:no-tenant';
export const NO_CSRF_KEY = 'gc:no-csrf';

/** Ruta sin sesión (login, registro, salud). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Ruta del panel de plataforma (sesión de plataforma, no de comercio). */
export const PlatformRoute = () => SetMetadata(PLATFORM_KEY, true);
/** Exige al menos uno de los permisos indicados en el comercio activo. Se verifica en el servidor. */
export const RequirePermission = (...anyOf: [PermissionCode, ...PermissionCode[]]) => SetMetadata(PERMISSION_KEY, anyOf);
/** Permite la ruta sin comercio activo o con el comercio suspendido. */
export const AllowNoTenant = () => SetMetadata(NO_TENANT_KEY, true);
/** Excluye de la verificación CSRF (solo rutas previas a tener sesión). */
export const SkipCsrf = () => SetMetadata(NO_CSRF_KEY, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  return req.actor!;
});

export const CurrentPlatformActor = createParamDecorator((_: unknown, ctx: ExecutionContext): PlatformActor => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  return req.platformActor!;
});

export const ClientInfo = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  return { ip: req.ip, userAgent: req.headers['user-agent'] ?? null, requestId: String(req.id) };
});
export interface ClientInfoValue {
  ip: string;
  userAgent: string | null;
  requestId: string;
}
