import type { ApiError } from '@gc/contracts';
import { appUrl } from './base-path';

/** Error de la API con el formato único { code, message, details, requestId }. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Errores de validación por campo, si los hay. */
  fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message]));
  }
}

export function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('gc_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(appUrl(`/api/v1${path}`), {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(res.status, err.code ?? 'HTTP_ERROR', err.message ?? `Error ${res.status}`, err.details, err.requestId);
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => api<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => api<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => api<T>('PUT', path, body),
  delete: <T>(path: string) => api<T>('DELETE', path),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return 'Ocurrió un error inesperado';
}
