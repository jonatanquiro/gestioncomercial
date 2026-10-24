import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../../config/env';
import { randomToken } from '../../common/crypto';

export const SESSION_COOKIE = 'gc_session';
export const PLATFORM_SESSION_COOKIE = 'gc_psession';
export const CSRF_COOKIE = 'gc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
export const PLATFORM_IDLE_MS = 2 * 60 * 60 * 1000;
export const PLATFORM_MAX_MS = 12 * 60 * 60 * 1000;

function base() {
  return { path: '/', sameSite: 'lax' as const, secure: loadEnv().COOKIE_SECURE };
}

export function setSessionCookie(reply: FastifyReply, name: string, token: string, maxAgeMs: number) {
  void reply.setCookie(name, token, { ...base(), httpOnly: true, maxAge: Math.floor(maxAgeMs / 1000) });
}

export function clearSessionCookie(reply: FastifyReply, name: string) {
  void reply.clearCookie(name, { ...base(), httpOnly: true });
}

/** Cookie legible por el frontend; el valor se repite en el header x-csrf-token (doble envío). */
export function issueCsrfCookie(reply: FastifyReply): string {
  const token = randomToken();
  void reply.setCookie(CSRF_COOKIE, token, { ...base(), httpOnly: false, maxAge: Math.floor(SESSION_MAX_MS / 1000) });
  return token;
}

/** Reutiliza la cookie CSRF existente o emite una nueva. */
export function ensureCsrfCookie(req: FastifyRequest, reply: FastifyReply): string {
  const current = req.cookies[CSRF_COOKIE];
  return current && current.length >= 32 ? current : issueCsrfCookie(reply);
}
