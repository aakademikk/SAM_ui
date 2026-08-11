/**
 * SAM — Global activity state.
 *
 * What SAM is *doing*, as a single value any component can set and the
 * background visualiser can render. This replaces polling the voice-line's
 * `/state` for the background: that URL is `127.0.0.1:8790`, which resolves to
 * the phone (not the desktop) when the PWA is used over Tailscale, so it could
 * never work on mobile and silently fell back to a scripted mock cycle.
 */

import { create } from 'zustand';

import type { VisualiserState } from '@/hooks/useVisualiserState';

interface SamActivityStore {
  activity: VisualiserState;
  setActivity: (activity: VisualiserState) => void;
}

export const useSamActivity = create<SamActivityStore>((set) => ({
  activity: 'idle',
  setActivity: (activity) => set({ activity }),
}));

/** Non-reactive setter, for callbacks that should not subscribe. */
export const setSamActivity = (activity: VisualiserState) =>
  useSamActivity.getState().setActivity(activity);
