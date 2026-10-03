/**
 * SAM — the wake word, as one hook (visual upgrade T14).
 *
 * Three ways a "Hey Sam" reaches the web app, moved here unchanged from the
 * Chat page's own effects so the Dashboard's chat widget can listen too:
 *
 * - launch: the Android service opens the app at `?wake=1&os_port=8765` when
 *   it hears the wake word. The port is where the native OS bridge listens;
 *   recording it is what lets "open Spotify" reach the phone.
 * - desktop: the desktop bridge publishes a wake counter and an open page
 *   polls it every 2 s (polling rather than a socket, because the voice
 *   service's WebSocket accepts a single connection).
 * - phone: relaunching the app over itself closed it (2026-10-01), so while
 *   the page is visible on the phone it polls the phone bridge's wake counter
 *   instead. The polls are also how the phone knows SAM is on screen
 *   (WakeGate.java); hidden, the page stops polling and says so, and the next
 *   "Hey Sam" launches the app as before.
 *
 * A counter is acted on only when it changes (`observeWakeSeq`), never on
 * its value, so a page opened long after a detection does not think it was
 * just woken.
 *
 * Only one surface may act on a wake (multi-chat Must 8: the wake word sends
 * to the chat on screen). Whoever is on screen passes `enabled: true`; with
 * `enabled: false` nothing polls and nothing fires, and re-enabling starts a
 * fresh baseline, so a wake heard while disabled is never replayed. The Chat
 * page and the Dashboard are separate routes, so at most one of them is
 * mounted at a time anyway.
 *
 * `onWake` is read through a ref, so a new callback identity does not restart
 * the polls; the effects depend on `enabled` only (the Chat page passes a
 * constant `true`, so its effects run exactly once on mount, as before).
 */

'use client';

import { useEffect, useRef } from 'react';

import { desktopWakeSeq } from '@/lib/desktopBridge';
import { configureOsBridge, phoneWakeSeq } from '@/lib/osBridge';
import { newWakeTracker, observeWakeSeq } from '@/lib/wakeSeq';

/** Which mechanism fired: the Chat page primes speech on a launch only, as it always has. */
export type WakeSource = 'launch' | 'desktop' | 'phone';

export function useWakeWord(onWake: (source: WakeSource) => void, enabled: boolean): void {
  const onWakeRef = useRef(onWake);
  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  /** `?wake=1` is one event per page load: acted on once, never again on a re-enable. */
  const launchHandledRef = useRef(false);

  /* ── Wake-word launch ── */
  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams(window.location.search);
    const port = params.get('os_port');
    configureOsBridge(port ? Number(port) : null);

    if (launchHandledRef.current) return;
    launchHandledRef.current = true;
    if (params.get('wake') === '1') onWakeRef.current('launch');
  }, [enabled]);

  /* ── Desktop wake word ── */
  useEffect(() => {
    if (!enabled) return;
    if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) return;

    let alive = true;
    const tracker = newWakeTracker();

    const tick = async () => {
      const seq = await desktopWakeSeq();
      if (!alive || !observeWakeSeq(tracker, seq)) return;
      onWakeRef.current('desktop');
    };

    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  /* ── Phone wake word while SAM is on screen ── */
  useEffect(() => {
    if (!enabled) return;
    if (!/android/i.test(navigator.userAgent)) return;

    let alive = true;
    const tracker = newWakeTracker();

    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const seq = await phoneWakeSeq(true);
      if (!alive || !observeWakeSeq(tracker, seq)) return;
      onWakeRef.current('phone');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
      else void phoneWakeSeq(false);
    };

    void tick();
    const id = setInterval(tick, 2000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
