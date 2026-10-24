import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cn } from './cn';

const control =
  'block w-full rounded-lg border bg-white px-3 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 disabled:bg-slate-100';

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
      className={cn(control, 'h-10', props['aria-invalid'] ? 'border-red-500' : 'border-slate-300', className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(control, 'h-10 pr-8', props['aria-invalid'] ? 'border-red-500' : 'border-slate-300', className)}
      {...props}
    />
  );
});
