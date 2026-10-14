'use client';

/**
 * SAM — reloads the page once when a newer build goes live (2026-10-14).
 * Why, and the rules, in src/lib/buildCheck.ts. Renders nothing.
 *
 * Busy means a reply is streaming (the chat page sets data-sam-busy on <html>)
 * or a text area holds a draft; the check then waits for the next look.
 */

import { useEffect } from 'react';

import { parseBuildId, RELOADED_KEY, shouldReload } from '@/lib/buildCheck';

const RECHECK_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 30 * 1000;

async function fetchBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/api/build', { cache: 'no-store' });
    if (!res.ok) return null;
    return parseBuildId(await res.json());
  } catch {
    return null;
  }
}

function isBusy(): boolean {
  if (document.documentElement.dataset.samBusy === '1') return true;
  return Array.from(document.querySelectorAll('textarea')).some((el) => el.value.trim() !== '');
}

export function BuildWatch() {
  useEffect(() => {
    let loaded: string | null = null;
    let lastCheck = 0;
    let stopped = false;

    const check = async (force = false) => {
      if (stopped || document.visibilityState !== 'visible') return;
      if (!force && Date.now() - lastCheck < MIN_GAP_MS) return;
      lastCheck = Date.now();
      const served = await fetchBuildId();
      if (stopped || !served) return;
      if (!loaded) {
        loaded = served;
        return;
      }
      let already: string | null = null;
      try { already = sessionStorage.getItem(RELOADED_KEY); } catch { /* private mode */ }
      if (shouldReload({ loaded, served, busy: isBusy(), alreadyReloadedFor: already })) {
        try { sessionStorage.setItem(RELOADED_KEY, served); } catch { /* private mode */ }
        window.location.reload();
      }
    };

    const onLook = () => { void check(); };
    // pageshow with persisted=true is a back/forward-cache restore: always check.
    const onPageShow = (e: PageTransitionEvent) => { void check(e.persisted); };

    void check(true);
    document.addEventListener('visibilitychange', onLook);
    window.addEventListener('focus', onLook);
    window.addEventListener('pageshow', onPageShow);
    const timer = window.setInterval(onLook, RECHECK_MS);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onLook);
      window.removeEventListener('focus', onLook);
      window.removeEventListener('pageshow', onPageShow);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
