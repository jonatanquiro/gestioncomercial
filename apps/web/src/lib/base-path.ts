/** Laravel informa el directorio de instalación; en Vite se usa la raíz. */
export function appBasePath(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="app-base-path"]')?.content.replace(/\/$/, '') ?? '';
}

export function appUrl(path: string): string {
  return `${appBasePath()}${path}`;
}

/** Normaliza también las ubicaciones tomadas directamente del navegador. */
export function internalPath(pathname: string): string {
  const base = appBasePath();
  return base && (pathname === base || pathname.startsWith(`${base}/`)) ? pathname.slice(base.length) || '/' : pathname;
}

/** Archivo de public/: Vite lo sirve en la raíz; compilado, Laravel lo expone en spa/. */
export function publicFile(file: string): string {
  return import.meta.env.DEV ? `/${file}` : appUrl(`/spa/${file}`);
}
