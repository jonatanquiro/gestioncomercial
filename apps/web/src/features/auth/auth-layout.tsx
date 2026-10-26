import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <aside className="relative hidden w-[44%] max-w-2xl flex-col justify-between overflow-hidden bg-linear-to-br from-slate-950 via-slate-900 to-brand-900 p-12 text-slate-300 lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-40 top-1/4 size-[32rem] rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -right-24 top-1/3 size-96 rounded-full border border-white/10" />
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-10" />
          <span className="text-lg font-semibold tracking-tight text-white">Gestión Comercial</span>
        </div>
        <div className="relative py-16">
          <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Gestión para tu día a día</p>
          <p className="text-5xl leading-tight font-semibold tracking-tight text-white">
            Tu comercio,
            <br />
            <span className="text-brand-400">en orden.</span>
          </p>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-slate-300">Ventas, caja y stock en un mismo lugar. Más claridad para vos, más tiempo para tu negocio.</p>
        </div>
        <div className="relative flex gap-3 text-xs text-slate-300"><span className="mt-1 size-2 rounded-full bg-brand-400" aria-hidden />Hecho para comercios de Argentina</div>
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-10" />
            <span className="text-lg font-semibold tracking-tight text-slate-900">Gestión Comercial</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
