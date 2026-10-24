import { queryOptions } from '@tanstack/react-query';
import { http } from '@/lib/api';

export interface PlatformMe {
  id: string;
  name: string;
  csrfToken: string;
}

export const platformMeQuery = queryOptions({
  queryKey: ['platform-me'],
  queryFn: () => http.get<PlatformMe>('/platform/auth/me'),
  staleTime: 60_000,
  retry: false,
});
