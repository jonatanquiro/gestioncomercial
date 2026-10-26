import type { Appearance } from '@gc/contracts';
import type { CSSProperties } from 'react';

export const DEFAULT_APPEARANCE: Appearance = { logoData: null, primaryColor: '#2563eb', menuColor: '#ffffff', font: 'system', navigation: 'side', textSize: 'normal', density: 'normal' };
export const FONTS = { system: '"Segoe UI", system-ui, sans-serif', archivo: '"Archivo Variable", system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif' };

function rgb(hex: string) { return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)); }
function mix(hex: string, target: number, weight: number) { return `rgb(${rgb(hex).map(c => Math.round(c * (1 - weight) + target * weight)).join(', ')})`; }
export function foreground(hex: string) {
  const luminance = rgb(hex).reduce((sum, c, i) => { const v = c / 255; return sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!; }, 0);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
export function appearanceStyle(value: Appearance): CSSProperties {
  const primary = value.primaryColor;
  return {
    '--color-brand-50': mix(primary, 255, .95), '--color-brand-100': mix(primary, 255, .88), '--color-brand-200': mix(primary, 255, .72), '--color-brand-300': mix(primary, 255, .52),
    '--color-brand-400': mix(primary, 255, .3), '--color-brand-500': mix(primary, 255, .1), '--color-brand-600': primary,
    '--color-brand-700': mix(primary, 0, .15), '--color-brand-800': mix(primary, 0, .3), '--color-brand-900': mix(primary, 0, .45),
    '--menu-background': value.menuColor, '--menu-foreground': foreground(value.menuColor),
    '--font-sans': FONTS[value.font], '--font-display': FONTS[value.font],
  } as CSSProperties;
}
