/**
 * Call-screening switch — shows whether the phone is screening calls and flips
 * it with one tap. Phone only: the flag lives in the SAM app.
 *
 * The state comes from the phone every time (on mount, after each tap), never
 * from what we last asked for, and an unreachable phone reads "phone offline"
 * rather than a guessed on or off.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneIncoming } from 'lucide-react';
import { getScreening, isPhone, setScreening } from '@/lib/osBridge';
import { subscribeScreeningChanged } from '@/lib/screeningEvents';

type State = 'loading' | 'on' | 'off' | 'offline';

function toState(enabled: boolean | null): State {
  if (enabled === null) return 'offline';
  return enabled ? 'on' : 'off';
}

export function ScreeningToggle() {
  const [phone, setPhone] = useState(false);
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(toState(await getScreening()));
  }, []);

  useEffect(() => {
    if (!isPhone()) return;
    setPhone(true);
    void refresh();
  }, [refresh]);

  // A voice or text command changed the flag: ask the phone again.
  useEffect(() => subscribeScreeningChanged(() => void refresh()), [refresh]);

  // Publish the bar's height so the chat's fixed-height root can leave room for
  // it; otherwise page + bar is taller than the screen and the page scrolls the
  // bar away.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!phone || !el) return;
    const root = document.documentElement;
    root.style.setProperty('--sam-screening-h', `${el.offsetHeight}px`);
    return () => {
      root.style.removeProperty('--sam-screening-h');
    };
  }, [phone, state]);

  const flip = async () => {
    if (busy || state === 'loading') return;
    setBusy(true);
    try {
      // Offline taps retry the read instead of writing blind.
      if (state === 'offline') {
        await refresh();
        return;
      }
      const result = await setScreening(state === 'off');
      // Re-read so the label is the phone's answer, not our request.
      setState(result === null ? 'offline' : toState(await getScreening()));
    } finally {
      setBusy(false);
    }
  };

  if (!phone) return null;

  const label =
    state === 'loading' ? 'Checking…' : state === 'offline' ? 'Phone offline' : state === 'on' ? 'On' : 'Off';

  return (
    // Sticky as well, so it stays on screen if anything does scroll the page.
    <div ref={barRef} className="sticky top-0 z-30 px-3 pt-3">
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-accent/30 bg-void-900 backdrop-blur-md">
      <PhoneIncoming size={14} className="text-accent" />
      <p className="text-xs text-dim-100 flex-1">Call screening: {label}</p>
      <button
        type="button"
        onClick={flip}
        disabled={busy || state === 'loading'}
        className="px-3 py-1 bg-accent text-void-950 text-xs font-semibold rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
      >
        {state === 'offline' ? 'Retry' : state === 'on' ? 'Turn off' : 'Turn on'}
      </button>
    </div>
    </div>
  );
}
