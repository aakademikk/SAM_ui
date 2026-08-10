/**
 * Registers the Serwist service worker in production only.
 *
 * Disabled in dev — a hot-reloading dev server and a service worker
 * that caches assets are enemies.
 */

'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      process.env.NODE_ENV !== 'production'
    ) {
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Auto-update: when a new SW is waiting, tell it to activate.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // New content available — activate it.
              registration.update();
            }
          });
        });
      })
      .catch((error) => {
        console.error('[SAM] Service worker registration failed:', error);
      });
  }, []);

  return null;
}
