import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Layers, LogOut, Store } from 'lucide-react';
import { http } from '@/lib/api';
import { publicFile } from '@/lib/base-path';
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

  const linkClass = 'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white';
  const activeClass = { className: 'bg-white/10 !text-white' };
  return (
    <div className="flex min-h-full flex-col">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-2">
            <img src={publicFile('icon.svg')} alt="" className="size-10" />
            <div>
              <span className="block font-display text-sm font-semibold text-white">Gestión Comercial.</span>
              <span className="text-xs text-brand-300">Administración de plataforma</span>
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
          <span className="hidden text-slate-300 sm:inline">{me.name}</span>
          <button onClick={() => void logout()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-300 hover:bg-white/5">
            <LogOut className="size-4" aria-hidden />
            Salir
          </button>
        </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 sm:px-8 sm:py-9 lg:px-12 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
