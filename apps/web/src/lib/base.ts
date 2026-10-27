/**
 * Ruta base donde está publicado el sistema: '' en la raíz de un sitio (http://localhost:8000)
 * o, por ejemplo, '/gestion-comercial' en https://celenial.com.ar/gestion-comercial.
 * La completa Laravel al servir index.html (meta gc-base), así una misma compilación sirve para los dos casos.
 */
function readBase(): string {
  const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="gc-base"]');
  const value = (meta?.content ?? '').trim();
  return value === '' || value === '/' ? '' : `/${value.replace(/^\/+|\/+$/g, '')}`;
}

export const BASE_PATH = readBase();

/** Dirección de un archivo de la web compilada (public/spa), por ejemplo el ícono. */
export function assetUrl(file: string): string {
  return `${BASE_PATH}/spa/${file.replace(/^\/+/, '')}`;
}
