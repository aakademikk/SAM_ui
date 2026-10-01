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

// ─── Web Push ────────────────────────────────────────────────────────────────
//
// Payload contract: scripts (sam-push) send { title, body, url, tag, ts }.
// The notification click either focuses an existing SAM_ui window or opens a
// new one at url. url is always same-origin — sam-push only ever builds
// absolute paths, never full origins.

self.addEventListener('push', (event) => {
  let payload: { title?: unknown; body?: unknown; url?: unknown; tag?: unknown } = {};
  try {
    const data = event.data?.json();
    if (data && typeof data === 'object') payload = data as typeof payload;
  } catch {
    // Malformed payload — show a minimal fallback rather than nothing.
  }

  const title =
    typeof payload.title === 'string' && payload.title ? payload.title : 'SAM';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const url = typeof payload.url === 'string' ? payload.url : '/';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'sam';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url, ts: Date.now() },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin);
      if (url.origin !== self.location.origin) return;

      // matchAll with type:'window' only ever returns WindowClients.
      const wins = (await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })) as WindowClient[];

      // Prefer a window already sat on the exact target (path + query) —
      // just focus it. Comparing pathname alone would wrongly treat
      // /chat?c=A and /chat?c=B as the same destination.
      for (const win of wins) {
        if (win.url && new URL(win.url).pathname + new URL(win.url).search === url.pathname + url.search) {
          await win.focus();
          return;
        }
      }

      // Otherwise take the first window and drive it there.
      for (const win of wins) {
        await win.focus();
        if (win.url && new URL(win.url).pathname + new URL(win.url).search !== url.pathname + url.search) {
          await win.navigate(url);
        }
        return;
      }

      // No window open at all.
      await self.clients.openWindow(url);
    })(),
  );
});
