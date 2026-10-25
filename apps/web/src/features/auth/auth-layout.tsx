import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <aside className="hidden w-[42%] max-w-xl flex-col justify-between bg-slate-900 p-12 text-slate-300 lg:flex">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-10" />
          <span className="text-lg font-semibold tracking-tight text-white">Gestión Comercial</span>
        </div>
        <div>
          <p className="text-4xl leading-tight font-semibold tracking-tight text-white">
            Tu comercio,
            <br />
            <span className="text-brand-400">en orden.</span>
          </p>
          <p className="mt-4 max-w-sm text-base text-slate-400">Para kioscos, almacenes y comercios de barrio que quieren dejar el cuaderno.</p>
        </div>
        <div className="h-1 w-16 rounded-full bg-brand-400" aria-hidden />
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
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
