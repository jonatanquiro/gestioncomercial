import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from './cn';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/**
 * Menú «⋯» para acciones secundarias o de riesgo: quedan a un toque más de distancia de la
 * acción principal. Se cierra con Escape, al elegir o al tocar afuera.
 */
export function ActionMenu({ label, items, text }: { label: string; items: MenuItem[]; text?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = items.filter((i) => !i.hidden);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (visible.length === 0) return null;
  return (
    <div ref={root} className="relative inline-block text-left">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        className={cn('inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100', open && 'bg-slate-100')}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className="size-5" aria-hidden />
        {text}
      </button>
      {open && (
        <div id={id} role="menu" className="absolute right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cn('block w-full px-4 py-3 text-left text-sm font-medium hover:bg-slate-50', item.danger ? 'text-red-700' : 'text-slate-700')}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
