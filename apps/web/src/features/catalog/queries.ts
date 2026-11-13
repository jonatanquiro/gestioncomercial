import type { BrandDto, CategoryDto, TenantDto, WarehouseDto } from '@gc/contracts';
import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { http } from '@/lib/api';

export const categoriesQuery = queryOptions({ queryKey: ['categories'], queryFn: () => http.get<CategoryDto[]>('/categories') });
export const brandsQuery = queryOptions({ queryKey: ['brands'], queryFn: () => http.get<BrandDto[]>('/brands') });
export const warehousesQuery = queryOptions({ queryKey: ['warehouses'], queryFn: () => http.get<WarehouseDto[]>('/warehouses') });
export const tenantQuery = queryOptions({ queryKey: ['tenant'], queryFn: () => http.get<TenantDto>('/tenant') });

/** Errores de Zod como { "campo.0.sub": mensaje }, mismo formato que details de la API. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Identificador para que un reintento del mismo envío no duplique la operación.
 * crypto.randomUUID solo existe en https o localhost; desde otra PC del local (http://192.168…)
 * se arma un UUID v4 con getRandomValues, que sí está disponible.
 */
export function newClientUuid(): string {
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
