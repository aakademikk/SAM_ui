/**
 * Keeps the screen awake while SAM is in the foreground.
 *
 * Without this, an Android PWA (Brave-hosted) drops its live session the
 * moment the screen times out: the tab gets throttled/backgrounded, the SSE
 * stream dies, and the app has to reconnect — which loses the mic state and
 * the last message. Requesting a screen wake lock keeps the screen on, so the
 * tab stays foregrounded and the connection stays alive.
 *
 * The browser auto-releases the lock when the tab is hidden or the device
 * locks, so we re-request on every visibilitychange back to visible and on
 * any unexpected release (OS power saving, low battery, etc). No-ops cleanly
 * where the API is unsupported or refused.
 */

'use client';

import { useEffect } from 'react';

export function ScreenWakeLock() {
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    async function request() {
      if (stopped) return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        // If the tab went hidden while we were acquiring, the lock is moot.
        if (document.visibilityState !== 'visible') {
          await sentinel.release();
          sentinel = null;
          return;
        }
        sentinel.addEventListener('release', () => {
          // Re-acquire if the OS dropped it on us while we were visible.
          if (!stopped && document.visibilityState === 'visible') {
            void request();
          }
        });
      } catch (err) {
        // Wake lock can be refused (low power, permissions, unsupported).
        console.debug('[SAM] wake lock refused:', err);
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void request();
      } else if (sentinel) {
        void sentinel.release();
        sentinel = null;
      }
    }

    void request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) void sentinel.release();
    };
  }, []);

  return null;
}
