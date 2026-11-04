import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cn } from './cn';

const controlBase =
  'block rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/10 disabled:bg-slate-100';

/**
 * Ocupa todo el ancho salvo que la pantalla le dé uno propio («w-40»): cn solo concatena, y en el
 * CSS w-full le ganaría a cualquier otro ancho sin prefijo.
 */
const control = (className?: string) => cn(controlBase, /(^|\s)w-/.test(className ?? '') ? null : 'w-full');

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Etiqueta, control y mensaje de error asociados para lectores de pantalla. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(control(className), 'h-11', props['aria-invalid'] ? 'border-red-500' : 'border-slate-300', className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(control(className), 'h-11 pr-8', props['aria-invalid'] ? 'border-red-500' : 'border-slate-300', className)}
      {...props}
    />
  );
});
