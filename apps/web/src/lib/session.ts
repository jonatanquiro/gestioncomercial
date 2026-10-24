import type { MeResponse, PermissionCode } from '@gc/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { http } from './api';

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => http.get<MeResponse & { csrfToken: string }>('/auth/me'),
  staleTime: 60_000,
  retry: false,
});

export function useMe() {
  return useQuery(meQuery).data!;
}

/** Visibilidad en la interfaz. La autorización real la hace siempre el backend. */
export function useCan() {
  const me = useMe();
  return (...anyOf: PermissionCode[]) => anyOf.some((p) => me.permissions.includes(p));
}
