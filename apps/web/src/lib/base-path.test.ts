import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { appBasePath, appUrl, internalPath } from './base-path';

afterEach(() => {
  document.querySelector('meta[name="app-base-path"]')?.remove();
  vi.unstubAllGlobals();
});

describe('instalación en subcarpeta', () => {
  it('conserva las URLs en la raíz cuando no hay prefijo', () => {
    expect(appBasePath()).toBe('');
    expect(appUrl('/app')).toBe('/app');
    expect(internalPath('/app/productos')).toBe('/app/productos');
  });

  it('envía la API al mismo directorio y reconoce las rutas internas', async () => {
    const meta = document.createElement('meta');
    meta.name = 'app-base-path';
    meta.content = '/gestion-comercial';
    document.head.append(meta);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    await api('GET', '/auth/csrf');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/gestion-comercial/api/v1/auth/csrf');
    expect(appUrl('/app')).toBe('/gestion-comercial/app');
    expect(internalPath('/gestion-comercial/plataforma/login')).toBe('/plataforma/login');
    expect(internalPath('/gestion-comercial-otro/app')).toBe('/gestion-comercial-otro/app');
  });
});
