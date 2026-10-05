/**
 * SAM — Preferences on the document, before first paint.
 *
 * The CSS layer reads three preference values off `<html>`: the ambient theme
 * (`data-ambient`), the background intensity (`--sam-bg-intensity`) and the
 * circuit-grid alpha (`--sam-grid-alpha`). The server cannot know them — they
 * live in this device's localStorage (`sam.preferences.v1`, the zustand
 * persist blob of `userPreferencesStore`) — so it renders the Toxic default.
 *
 * Two halves keep the document right (floor-fixes Must 9, 11 and 24):
 *  - `bootScript`, inlined as the first child of `<head>`, applies the saved
 *    values before anything paints, so a reload never shows Toxic first.
 *  - `PreferencesApplier`, mounted once in `AppShell`, keeps the document in
 *    step with the store afterwards, so a change in Settings shows at once.
 *
 * Both use the helpers below, so the two can never disagree.
 */

import type { AmbientTheme } from '@/types/dashboard';

/** The zustand persist key in `userPreferencesStore.ts`. Do not change one without the other. */
export const PREFERENCES_KEY = 'sam.preferences.v1';

/** Every theme with a `:root[data-ambient=...]` block (or, for `void`, the `:root` defaults). */
export const AMBIENT_THEME_IDS: readonly AmbientTheme[] = ['void', 'plasma', 'toxic', 'ember', 'ghost', 'emerald'];

export function isAmbientTheme(value: unknown): value is AmbientTheme {
  return typeof value === 'string' && (AMBIENT_THEME_IDS as readonly string[]).includes(value);
}

/**
 * The store's defaults (`userPreferencesStore.ts`). A saved blob missing a
 * value gets these from the store's merge, so the boot script uses them too.
 */
const DEFAULT_INTENSITY = 0.75;

/** Background intensity clamped to 0..1; anything not a number reads as the default. */
export function clampIntensity(intensity: unknown): number {
  const i = typeof intensity === 'number' && Number.isFinite(intensity) ? intensity : DEFAULT_INTENSITY;
  return Math.min(1, Math.max(0, i));
}

/**
 * The circuit grid tracks intensity so the two layers never fight. This is the
 * formula `DashboardShell` used before it moved here; `bootScript` restates it
 * in ES5 and a test holds the two equal.
 */
export function gridAlphaFor(intensity: number, gridOverlay: boolean): string {
  return gridOverlay ? (0.02 + intensity * 0.05).toFixed(3) : '0';
}

/**
 * Plain ES5, no dependencies, runs before React and before any stylesheet
 * matters. Any failure (no storage, garbage JSON, an unknown theme, a missing
 * value) leaves the server's `data-ambient="toxic"` and the CSS defaults alone.
 */
export const bootScript = `(function(){try{
var raw=window.localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)});
if(!raw)return;
var s=JSON.parse(raw);s=s&&s.state;if(!s||typeof s!=='object')return;
var root=document.documentElement;
var ids=${JSON.stringify(AMBIENT_THEME_IDS)};
if(typeof s.ambientTheme==='string'&&ids.indexOf(s.ambientTheme)!==-1)root.dataset.ambient=s.ambientTheme;
var i=s.backgroundIntensity;
if(typeof i!=='number'||!isFinite(i))i=${DEFAULT_INTENSITY};
i=Math.min(1,Math.max(0,i));
root.style.setProperty('--sam-bg-intensity',i.toFixed(2));
root.style.setProperty('--sam-grid-alpha',s.gridOverlay!==false?(0.02+i*0.05).toFixed(3):'0');
}catch(e){}})();`;
