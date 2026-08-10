/**
 * Registers the Serwist service worker and captures the install prompt
 * event so we can show a custom install button.
 *
 * Disabled in dev — a hot-reloading dev server and a service worker
 * that caches assets are enemies.
 */

'use client';

import { useEffect } from 'react';

// Chrome's non-standard beforeinstallprompt event type.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Store the install event globally so any component can trigger it.
let deferredInstall: BeforeInstallPromptEvent | null = null;

export function getDeferredInstall(): BeforeInstallPromptEvent | null {
  return deferredInstall;
}

/** Call this from a click handler to show the native install dialog. */
export async function triggerInstall(): Promise<boolean> {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const result = await deferredInstall.userChoice;
  deferredInstall = null;
  return result.outcome === 'accepted';
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Always register the SW in production. In dev we skip it entirely.
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('[SAM] SW registered, scope:', registration.scope);

        // If there's a waiting worker, it means a new version is ready.
        if (registration.waiting) {
          console.log('[SAM] SW waiting — new version ready on next reload');
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              console.log('[SAM] SW updated — reload to activate');
            }
          });
        });
      })
      .catch((error) => {
        console.error('[SAM] SW registration failed:', error);
      });

    // Capture the beforeinstallprompt event so we can show a custom button.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredInstall = e as BeforeInstallPromptEvent;
      console.log('[SAM] Install prompt available — show install button');
      // Dispatch a custom event so the UI can react.
      window.dispatchEvent(new CustomEvent('sam:installready'));
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Log when the app was successfully installed.
    const onInstalled = () => {
      console.log('[SAM] App installed');
      deferredInstall = null;
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return null;
}
