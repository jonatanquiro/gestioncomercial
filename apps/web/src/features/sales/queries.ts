import type { AuthorizerDto, CashShiftDto, PaymentMethodDto, PermissionCode, PinAuthorizationInput, RegisterDto } from '@gc/contracts';
import { queryOptions } from '@tanstack/react-query';
import { ApiRequestError, http } from '@/lib/api';

export const registersQuery = queryOptions({ queryKey: ['registers'], queryFn: () => http.get<RegisterDto[]>('/registers') });
export const paymentMethodsQuery = queryOptions({ queryKey: ['payment-methods'], queryFn: () => http.get<PaymentMethodDto[]>('/payment-methods') });
export const shiftQuery = (id: string) => queryOptions({ queryKey: ['shifts', id], queryFn: () => http.get<CashShiftDto>(`/shifts/${id}`) });
export const authorizersQuery = (permission: PermissionCode) =>
  queryOptions({ queryKey: ['authorizers', permission], queryFn: () => http.get<AuthorizerDto[]>(`/pos/authorizers?permission=${permission}`) });

/** La acción necesita el PIN de un encargado: el pedido se repite con la autorización. */
export function needsAuthorization(err: unknown): PermissionCode | null {
  if (err instanceof ApiRequestError && (err.code === 'AUTHORIZATION_REQUIRED' || err.code === 'AUTHORIZATION_INVALID')) {
    return ((err.details as { permission?: PermissionCode } | undefined)?.permission ?? null) as PermissionCode | null;
  }
  return null;
}

export type Authorization = PinAuthorizationInput | null;

/** Caja elegida en este equipo: cada PC o tablet del local suele ser siempre la misma caja. */
const REGISTER_KEY = 'gc.registerId';
export function rememberedRegister(): string | null {
  try {
    return localStorage.getItem(REGISTER_KEY);
  } catch {
    return null;
  }
}
export function rememberRegister(id: string) {
  try {
    localStorage.setItem(REGISTER_KEY, id);
  } catch {
    // sin almacenamiento local, se vuelve a elegir la caja
  }
}
