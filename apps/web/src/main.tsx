import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@/components/ui/toast';
import { ApiRequestError } from '@/lib/api';
import { createAppRouter } from './app/router';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Los errores de cliente (4xx) no se reintentan; solo fallas de red o del servidor.
      retry: (count, err) => count < 2 && !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

const router = createAppRouter(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
