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
import { Serwist, NetworkFirst, NetworkOnly, ExpirationPlugin } from 'serwist';

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
    // Navigation — network only, offline page as fallback.
    //
    // This was NetworkFirst with a 'sam-pages' cache, which produced a page
    // that was guaranteed to be broken. Cached HTML names the JS chunks of the
    // build it came from, but the precache only ever holds the *current*
    // build's chunks — earlier ones are purged on activate. So when a
    // navigation failed, the stale HTML was served and every chunk it asked
    // for 404'd, surfacing as "Application error: a client-side exception has
    // occurred" rather than the offline page. Exactly that happened on the
    // phone when the tailnet hostname stopped resolving.
    //
    // Going straight to /offline is also what the rest of this file already
    // decided: a cached agent status is worse than showing nothing.
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkOnly(),
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
