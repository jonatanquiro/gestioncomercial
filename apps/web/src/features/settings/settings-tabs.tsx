import type { PermissionCode } from '@gc/contracts';
import { Link } from '@tanstack/react-router';
import { useCan } from '@/lib/session';

export type SectionTab = { to: string; label: string; anyOf: PermissionCode[] };

/** Secciones de Configuración: una sola entrada en el menú y pestañas adentro. */
export const SETTINGS_TABS: SectionTab[] = [
  { to: '/app/configuracion', label: 'Datos del negocio', anyOf: ['settings.manage'] },
  { to: '/app/cajas', label: 'Cajas y medios de pago', anyOf: ['branches.manage', 'settings.manage'] },
  { to: '/app/facturacion', label: 'Facturación ARCA', anyOf: ['fiscal.manage'] },
  { to: '/app/apariencia', label: 'Apariencia', anyOf: ['settings.manage'] },
];

/** Cobros: el listado para revisar y las rendiciones contra los reportes del proveedor. */
export const PAYMENTS_TABS: SectionTab[] = [
  { to: '/app/cobros', label: 'Cobros', anyOf: ['cash.read_all'] },
  { to: '/app/rendiciones', label: 'Rendiciones', anyOf: ['cash.read_all'] },
];

export function SettingsTabs() {
  return <SectionTabs tabs={SETTINGS_TABS} label="Secciones de configuración" />;
}

export function SectionTabs({ tabs: all, label }: { tabs: SectionTab[]; label: string }) {
  const can = useCan();
  const tabs = all.filter((t) => can(...t.anyOf));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className="-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-slate-500 hover:text-slate-800"
          activeProps={{ className: '!border-brand-600 !text-brand-700', 'aria-current': 'page' }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
