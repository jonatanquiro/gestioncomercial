import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Layers, LogOut, Store } from 'lucide-react';
import { http } from '@/lib/api';
import { platformMeQuery } from './platform-session';

export function PlatformLayout() {
  const me = useQuery(platformMeQuery).data!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logout() {
    await http.post('/platform/auth/logout').catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/plataforma/login' });
  }

  const linkClass = 'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900';
  const activeClass = { className: 'bg-brand-50 !text-brand-700' };
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 lg:px-8">
        <div className="flex flex-wrap items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-10" />
            <div>
              <span className="block text-sm font-bold text-slate-900">Gestión Comercial</span>
              <span className="text-xs text-slate-500">Administración de plataforma</span>
            </div>
          </div>
          <nav className="flex gap-1" aria-label="Navegación de la plataforma">
            <Link to="/plataforma" activeOptions={{ exact: true }} className={linkClass} activeProps={activeClass}>
              <Store className="size-4" aria-hidden />
              Comercios
            </Link>
            <Link to="/plataforma/planes" className={linkClass} activeProps={activeClass}>
              <Layers className="size-4" aria-hidden />
              Planes
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-500 sm:inline">{me.name}</span>
          <button onClick={() => void logout()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">
            <LogOut className="size-4" aria-hidden />
            Salir
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-9">
        <Outlet />
      </main>
    </div>
  );
}
