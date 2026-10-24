import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, readCookie } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'gc_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('cliente de la API', () => {
  it('envía el token CSRF en las mutaciones y no en las lecturas', async () => {
    document.cookie = 'gc_csrf=abc123';
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('POST', '/branches', { name: 'x' });
    await api('GET', '/branches');
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect((calls[0]![1].headers as Record<string, string>)['x-csrf-token']).toBe('abc123');
    expect((calls[1]![1].headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    expect(calls[0]![0]).toBe('/api/v1/branches');
  });

  it('traduce el formato único de error y expone los errores por campo', async () => {
    const body = { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: [{ path: 'email', message: 'Email inválido' }], requestId: 'r1' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 400 })));
    const err = await api('POST', '/auth/login', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).fieldErrors()).toEqual({ email: 'Email inválido' });
    expect((err as ApiRequestError).requestId).toBe('r1');
  });

  it('informa la falta de conexión sin inventar una respuesta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const err = (await api('GET', '/auth/me').catch((e: unknown) => e)) as ApiRequestError;
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.status).toBe(0);
  });

  it('lee cookies por nombre exacto', () => {
    document.cookie = 'gc_csrf=xyz';
    expect(readCookie('gc_csrf')).toBe('xyz');
    expect(readCookie('gc_csr')).toBeNull();
  });
});
