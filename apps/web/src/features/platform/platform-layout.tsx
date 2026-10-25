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

  const linkClass = 'flex h-14 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-slate-300 hover:text-white';
  const activeClass = { className: '!border-brand-400 !text-white' };
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-14 items-center justify-between gap-4 bg-slate-900 px-4 text-white lg:px-8">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-7" />
            <span className="rounded bg-brand-400 px-2 py-0.5 text-xs font-bold tracking-wide text-slate-900 uppercase">Plataforma</span>
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
          <span className="hidden text-slate-300 sm:inline">{me.name}</span>
          <button onClick={() => void logout()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
            <LogOut className="size-4" aria-hidden />
            Salir
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
