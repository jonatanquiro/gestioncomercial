import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@gc/contracts';
import type { FastifyRequest } from 'fastify';
import { safeEqual } from '../../common/crypto';
import { NO_CSRF_KEY, NO_TENANT_KEY, PERMISSION_KEY, PLATFORM_KEY, PUBLIC_KEY } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { ActorService } from './actor.service';
import { CSRF_COOKIE, CSRF_HEADER, PLATFORM_SESSION_COOKIE, SESSION_COOKIE } from './cookies';
import { PlatformSessionService } from './platform-session.service';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global. Orden: ruta pública → sesión (comercio o plataforma) → CSRF en
 * mutaciones → comercio activo y no suspendido → permiso requerido.
 * Toda ruta que no sea @Public exige sesión: el default es cerrado.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly platformSessions: PlatformSessionService,
    private readonly actors: ActorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const flag = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, targets);
    const req = context.switchToHttp().getRequest<FastifyRequest>();

    if (flag<boolean>(PUBLIC_KEY)) return true;

    if (!SAFE_METHODS.has(req.method) && !flag<boolean>(NO_CSRF_KEY)) {
      const cookie = req.cookies[CSRF_COOKIE];
      const header = req.headers[CSRF_HEADER];
      if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) throw Errors.csrf();
    }

    if (flag<boolean>(PLATFORM_KEY)) {
      const token = req.cookies[PLATFORM_SESSION_COOKIE];
      const session = token ? await this.platformSessions.validate(token) : null;
      if (!session) throw Errors.unauthenticated();
      req.platformActor = { ...session, ip: req.ip, requestId: String(req.id) };
      return true;
    }

    const token = req.cookies[SESSION_COOKIE];
    const session = token ? await this.sessions.validate(token) : null;
    if (!session) throw Errors.unauthenticated();
    const actor = await this.actors.resolve(session, { ip: req.ip, requestId: String(req.id) });
    req.actor = actor;

    if (!flag<boolean>(NO_TENANT_KEY)) {
      if (!actor.tenantId) throw Errors.noTenant();
      if (actor.tenantStatus === 'suspended' || actor.tenantStatus === 'cancelled') throw Errors.tenantSuspended();
    }

    const required = flag<PermissionCode[]>(PERMISSION_KEY);
    if (required && !required.some((p) => actor.permissions.has(p))) throw Errors.forbidden(required.join(' | '));
    return true;
  }
}
