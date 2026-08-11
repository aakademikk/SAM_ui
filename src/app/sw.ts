/// <reference lib="webworker" />

/**
 * Serwist service worker.
 *
 * Caching strategy:
 *   - Static assets (JS, CSS, fonts, images): CacheFirst — precached at build.
 *   - API / job data: NetworkFirst — never serve stale agent state.
 *   - Navigation: NetworkFirst with offline fallback page.
 */

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist, NetworkFirst, ExpirationPlugin } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // API and job data — network first, never serve stale.
    // A cached agent status is worse than showing nothing.
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: 'sam-apis',
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 }),
        ],
      }),
    },
    // App identity — the manifest and the launcher icons. These must be network
    // first: under the default CacheFirst they are precached at build, so a new
    // icon never reaches an installed PWA and the home screen keeps painting the
    // old one (and the splash screen built from it) indefinitely.
    {
      matcher: ({ url }) =>
        url.pathname === '/manifest.json' || url.pathname.startsWith('/icons/'),
      handler: new NetworkFirst({
        cacheName: 'sam-app-identity',
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 }),
        ],
      }),
    },
    // Navigation — network first, offline page as fallback.
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'sam-pages',
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 300 }),
        ],
      }),
    },
    // Default cache handles static assets (precached + runtime).
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => request.mode === 'navigate',
      },
    ],
  },
});

serwist.addEventListeners();
