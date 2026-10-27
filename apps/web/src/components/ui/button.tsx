import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 disabled:bg-brand-600/60',
  secondary: 'bg-white text-slate-700 border border-slate-200 shadow-xs hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/60',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  /** Acción de tabla: discreta pero con área de toque cómoda. */
  subtle: 'text-brand-700 hover:bg-brand-50 disabled:text-slate-400',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-10 px-3.5 text-sm' : 'h-11 px-5 text-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
