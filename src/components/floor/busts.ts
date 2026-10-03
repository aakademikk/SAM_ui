/**
 * SAM — the god busts' brightness and Zeus's dispatch flare (T8).
 *
 * Pure timing functions, no canvas or DOM. Ported from the design source's
 * `src/e-scene.js` (`bustLevel`, `flareAt`) in the approved mockup E:
 *
 * - A General's bust is drawn additively at 40% when idle and 100% when
 *   working, with a 0.3 s linear ramp from the moment its Idle/Working state
 *   changes, either way (Must 10).
 * - Zeus's lightning flares when a job is dispatched, and at no other time
 *   (Must 9): one sharp strike and a smaller second strike, over about a
 *   second (window 1.2 s).
 * - Reduced motion (Must 6): no flare ever, and the busts show their static
 *   idle/working level only (no ramp).
 */

export const IDLE_LEVEL = 0.4;
export const WORKING_LEVEL = 1;
/** The brightness ramp on an Idle/Working change (e-scene.js: `lin(t, T, T + .3)`). */
export const BUST_RAMP_MS = 300;
/** Zeus's flare lasts this long after the dispatch (e-scene.js `flareAt`: `d > 1.2` returns 0). */
export const FLARE_WINDOW_MS = 1200;
/** A card's small bust: 45% when idle, full when working (e-hybrid.html `.g-bust{opacity:.45}`). */
export const CARD_IDLE_ALPHA = 0.45;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * A General's bust brightness (additive alpha).
 *
 * `idle` is its current state; `msSinceChange` is the time since that state
 * last flipped (`Infinity` when it has not flipped since the page opened).
 * Becoming working ramps 0.4 → 1 over 300 ms; becoming idle ramps 1 → 0.4.
 * Under reduced motion the level is static: 0.4 idle, 1 working.
 */
export function bustLevel(idle: boolean, msSinceChange: number, reduced = false): number {
  if (reduced || !Number.isFinite(msSinceChange) || Number.isNaN(msSinceChange)) return idle ? IDLE_LEVEL : WORKING_LEVEL;
  const r = clamp01(msSinceChange / BUST_RAMP_MS);
  const span = WORKING_LEVEL - IDLE_LEVEL;
  return idle ? WORKING_LEVEL - span * r : IDLE_LEVEL + span * r;
}

/** How far a level is from idle towards working, 0..1 (e-scene.js `wk = (lv - .4) / .6`): drives the halo, emitter and beam. */
export function workingK(level: number): number {
  return clamp01((level - IDLE_LEVEL) / (WORKING_LEVEL - IDLE_LEVEL));
}

/** A card's small bust opacity for a scene level: 0.45 idle, 1 working, following the same ramp. */
export function cardBustAlpha(level: number): number {
  return CARD_IDLE_ALPHA + (1 - CARD_IDLE_ALPHA) * workingK(level);
}

/**
 * Zeus's flare intensity, 0..1, `msSinceDispatch` after a job's `dispatched`
 * event landed. Constants copied from e-scene.js `flareAt` (seconds there):
 * a strike rising over 80 ms then decaying (e^-5t), plus a second strike at
 * 60% from 240 ms (40 ms rise, e^-8t decay). 0 before the dispatch, after the
 * 1.2 s window, and always under reduced motion.
 */
export function flareIntensity(msSinceDispatch: number, reduced = false): number {
  if (reduced || Number.isNaN(msSinceDispatch)) return 0;
  const d = msSinceDispatch / 1000;
  if (d < 0 || d > FLARE_WINDOW_MS / 1000) return 0;
  const a = d < 0.08 ? d / 0.08 : Math.exp(-(d - 0.08) * 5);
  const b = d < 0.24 ? 0 : 0.6 * Math.min(1, (d - 0.24) / 0.04) * Math.exp(-(d - 0.28) * 8);
  return Math.min(1, a + Math.max(0, b));
}

/** jobId → when its flare started (ms). `-Infinity` marks a job seen but never to flare. */
export type FlareLog = Record<string, number>;

/**
 * Records which dispatches should flare, from one poll's
 * `FloorState.dispatchFlares`. A flare fires only for an entry new since the
 * previous poll: on the first poll after page load every entry present is
 * marked seen without a flare, and a jobId already in the log never flares
 * again (even if it drops out of the list and comes back).
 */
export function recordFlares(
  log: Readonly<FlareLog>, entries: readonly { jobId: string }[] | null | undefined, now: number, firstPoll: boolean,
): FlareLog {
  const out: FlareLog = { ...log };
  for (const e of entries ?? []) {
    if (!e || typeof e.jobId !== 'string' || e.jobId in out) continue;
    out[e.jobId] = firstPoll ? Number.NEGATIVE_INFINITY : now;
  }
  return out;
}

/** The flare to draw now: the strongest of any flares in flight (0 when none, or under reduced motion). */
export function currentFlare(log: Readonly<FlareLog>, now: number, reduced = false): number {
  if (reduced) return 0;
  let f = 0;
  for (const at of Object.values(log)) {
    if (at === Number.NEGATIVE_INFINITY) continue;
    f = Math.max(f, flareIntensity(now - at));
  }
  return f;
}
