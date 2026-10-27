import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicFile } from './base-path';

afterEach(() => {
  document.querySelector('meta[name="app-base-path"]')?.remove();
  vi.unstubAllEnvs();
});

describe('archivos de public/ compilados', () => {
  it('apuntan a spa/ dentro de la subcarpeta, desde cualquier pantalla', () => {
    vi.stubEnv('DEV', false);
    const meta = document.createElement('meta');
    meta.name = 'app-base-path';
    meta.content = '/gestion-comercial';
    document.head.append(meta);
    expect(publicFile('icon.svg')).toBe('/gestion-comercial/spa/icon.svg');
  });

  it('apuntan a /spa en la raíz y a la raíz con Vite', () => {
    vi.stubEnv('DEV', false);
    expect(publicFile('icon.svg')).toBe('/spa/icon.svg');
    vi.stubEnv('DEV', true);
    expect(publicFile('icon.svg')).toBe('/icon.svg');
  });
});
