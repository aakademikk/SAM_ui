/**
 * SAM — Global activity state.
 *
 * What SAM is *doing*, as a single value any component can set and the
 * background visualiser can render. This replaces polling the voice-line's
 * `/state` for the background: that URL is `127.0.0.1:8790`, which resolves to
 * the phone (not the desktop) when the PWA is used over Tailscale, so it could
 * never work on mobile and silently fell back to a scripted mock cycle.
 *
 * ## Why channels, and not one value
 *
 * A single last-writer-wins value could not hold the truth. Two independent
 * writers raced it: the chat page's phase effect and the TTS `onState`
 * callback. TTS finishing wrote `idle` even when a fresh turn was already
 * running, and a turn starting wrote `thinking` over audio that was still
 * playing — whichever fired last won, which is not the same as whichever is
 * true.
 *
 * So each source owns its own slot and clears only its own slot. The activity
 * is *derived*: the highest-priority slot that currently holds a value. An
 * alert outranks the mic, the mic outranks audio playback, audio outranks the
 * agent — read top-down that is exactly the order these matter to Colin.
 */

import { create } from 'zustand';

import type { VisualiserState } from '@/hooks/useVisualiserState';

/**
 * Who is reporting. Ordered by priority, highest first — `PRIORITY` below is
 * derived from this array, so reordering here reorders the resolution.
 */
export const ACTIVITY_SOURCES = ['alert', 'mic', 'speech', 'agent'] as const;

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

type Channels = Record<ActivitySource, VisualiserState | null>;

const EMPTY: Channels = { alert: null, mic: null, speech: null, agent: null };

/** Highest-priority channel holding a value, else idle. */
function resolve(channels: Channels): VisualiserState {
  for (const source of ACTIVITY_SOURCES) {
    const value = channels[source];
    if (value) return value;
  }
  return 'idle';
}

interface SamActivityStore {
  /** Derived — the one value the visualiser renders. */
  activity: VisualiserState;
  channels: Channels;
  /** Set or clear one channel. `null` clears it. */
  setActivity: (source: ActivitySource, activity: VisualiserState | null) => void;
  /** Clear every channel — used on unmount, so a dead screen never pins a state. */
  clearActivity: () => void;
}

export const useSamActivity = create<SamActivityStore>((set) => ({
  activity: 'idle',
  channels: { ...EMPTY },
  setActivity: (source, activity) =>
    set((state) => {
      // Zustand compares by reference, so a no-op write would still notify
      // every subscriber. The visualiser re-reads uniforms on state change, so
      // bail early rather than churn it 10x a second while a turn streams.
      if (state.channels[source] === activity) return state;
      const channels = { ...state.channels, [source]: activity };
      return { channels, activity: resolve(channels) };
    }),
  clearActivity: () => set({ channels: { ...EMPTY }, activity: 'idle' }),
}));

/** Non-reactive setter, for callbacks that should not subscribe. */
export const setSamActivity = (source: ActivitySource, activity: VisualiserState | null) =>
  useSamActivity.getState().setActivity(source, activity);

/** Non-reactive reset, for unmount cleanup. */
export const clearSamActivity = () => useSamActivity.getState().clearActivity();
