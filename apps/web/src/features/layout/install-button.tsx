import { Download } from 'lucide-react';
import { useInstallApp } from '@/lib/install';

/** Aparece solo cuando el navegador permite instalar la app (no en iPhone ni si ya está instalada). */
export function InstallAppButton({ className = '' }: { className?: string }) {
  const install = useInstallApp();
  if (!install) return null;
  return (
    <button type="button" onClick={() => void install()} className={`flex items-center gap-2 ${className}`}>
      <Download className="size-4" aria-hidden />
      Instalar la app
    </button>
  );
}
