import { useSyncExternalStore } from 'react';
import { appUrl } from './base-path';

/** Evento de Chrome/Edge/Android para ofrecer instalar la app (no está en los tipos del DOM). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pending: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/**
 * Se llama al arrancar, antes de React: el navegador avisa una sola vez, a veces antes de que
 * se dibuje la pantalla. El service worker vive en la carpeta del sistema (ver apps/server/public/sw.js).
 */
export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pending = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    pending = null;
    notify();
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(appUrl('/sw.js'), { scope: appUrl('/') }).catch(() => undefined);
  }
}

/** Devuelve la función para instalar, o null si el navegador no lo ofrece (ya instalada, iPhone, etc.). */
export function useInstallApp(): (() => Promise<void>) | null {
  const available = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending !== null,
  );
  if (!available) return null;
  return async () => {
    const event = pending;
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    pending = null;
    notify();
  };
}
