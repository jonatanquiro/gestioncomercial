import { Delete } from 'lucide-react';
import { useState } from 'react';
import { cn } from './cn';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'back'] as const;
const STORAGE_KEY = 'gc.pos.keypad';

/**
 * Teclado numérico en pantalla para operar con el dedo. Edita texto en formato local
 * ("1250,5"); el campo de al lado sigue aceptando el teclado físico.
 */
export function NumPad({ value, onChange, decimals = true, className }: { value: string; onChange: (v: string) => void; decimals?: boolean; className?: string }) {
  function press(key: (typeof KEYS)[number]) {
    if (key === 'back') return onChange(value.slice(0, -1));
    if (key === ',') return value.includes(',') ? undefined : onChange(`${value || '0'},`);
    onChange(value === '0' ? key : value + key);
  }
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)} role="group" aria-label="Teclado numérico">
      {KEYS.map((key) =>
        key === ',' && !decimals ? (
          <span key={key} />
        ) : (
          <button
            key={key}
            type="button"
            tabIndex={-1}
            aria-label={key === 'back' ? 'Borrar último número' : undefined}
            className="flex h-14 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl font-semibold shadow-xs active:bg-brand-50 active:ring-2 active:ring-brand-500"
            onClick={() => press(key)}
          >
            {key === 'back' ? <Delete className="size-6" /> : key}
          </button>
        ),
      )}
      <button type="button" tabIndex={-1} className="col-span-3 h-11 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100" onClick={() => onChange('')}>
        Borrar todo
      </button>
    </div>
  );
}

/** Mostrar u ocultar el teclado en pantalla. Arranca visible en pantallas táctiles y se recuerda en el equipo. */
export function useKeypadPreference() {
  const [visible, setVisible] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) return saved === '1';
    } catch {
      // sin almacenamiento local se decide por el tipo de pantalla
    }
    return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  });
  const toggle = () =>
    setVisible((v) => {
      try {
        localStorage.setItem(STORAGE_KEY, v ? '0' : '1');
      } catch {
        // la preferencia dura hasta recargar
      }
      return !v;
    });
  return [visible, toggle] as const;
}
