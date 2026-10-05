/**
 * PreferencesApplier — keeps `<html>` in step with the preference store.
 *
 * The inline `bootScript` (`src/lib/preferencesBoot.ts`) paints the saved
 * theme, intensity and grid before React loads; this takes over afterwards so
 * a change in Settings (or `/classic`'s gear) shows at once, with no reload,
 * on every page (floor-fixes Must 9, 24). Mounted once in `AppShell`.
 *
 * It reads the store imperatively (`getState` plus `subscribe`), not through a
 * hook. During hydration a hook's snapshot is zustand's un-hydrated initial
 * state (the defaults), so applying it would write the defaults over what the
 * boot script painted until a forced re-render put the saved values back. The
 * store itself already holds the saved values: persist reads localStorage
 * synchronously when the module loads.
 */

'use client';

import { useEffect } from 'react';

import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { clampIntensity, gridAlphaFor, isAmbientTheme } from '@/lib/preferencesBoot';

export type Prefs = Pick<ReturnType<typeof useUserPreferencesStore.getState>, 'ambientTheme' | 'backgroundIntensity' | 'gridOverlay'>;

/** The three writes onto `<html>`; exported so the test can run them against a stub root. */
export function applyPreferences(root: HTMLElement, s: Prefs): void {
  // A garbage id from an old blob would select no theme block at all; the
  // boot script ignores it, so this does too.
  if (isAmbientTheme(s.ambientTheme)) root.dataset.ambient = s.ambientTheme;
  const intensity = clampIntensity(s.backgroundIntensity);
  root.style.setProperty('--sam-bg-intensity', intensity.toFixed(2));
  // The circuit grid tracks intensity so the two layers never fight.
  root.style.setProperty('--sam-grid-alpha', gridAlphaFor(intensity, s.gridOverlay));
}

/** Apply the store's current state once, then every change; returns the unsubscribe. */
export function startApplying(
  root: HTMLElement,
  store: { getState: () => Prefs; subscribe: (listener: (s: Prefs) => void) => () => void },
): () => void {
  const apply = (s: Prefs) => applyPreferences(root, s);
  apply(store.getState());
  return store.subscribe(apply);
}

export function PreferencesApplier() {
  useEffect(() => startApplying(document.documentElement, useUserPreferencesStore), []);

  return null;
}
