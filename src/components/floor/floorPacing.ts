/**
 * SAM — floor frame pacing (audit-fix T13). At rest the floor only bobs and
 * glows, so redrawing the whole scene 60 times a second is wasted work. The
 * loop keeps requesting frames but only draws when `frameDue`: every frame
 * while anything is moving (`isBusy`), otherwise at most every 100 ms.
 * Pure; no DOM.
 */

import { FLARE_WINDOW_MS } from './busts.js';
import { FX, GENERALS, type FloorFx } from './floorRender.js';
import type { FloorState } from '@/types/floor';

/** The longest gap between draws on an idle floor (about 10 fps). */
export const IDLE_FRAME_MS = 100;
/** The zoom between views lasts this long (camNow in FloorCanvas). */
export const ZOOM_MS = 950;
/** A ring tick that fired is treated as in flight this long. */
export const RING_FIRE_MS = 6000;

export interface PacingState {
  /** Date.now(): the clock the effects, idle flips and flares are stamped with. */
  wall: number;
  /** performance.now(): the clock `viewT0` is stamped with. */
  perf: number;
  fx: FloorFx;
  flares: Readonly<Record<string, number>>;
  viewT0: number;
  /** A General's column is under the pointer. */
  hover: boolean;
  /** A worker is running or a General is not idle (steady flow pulses and figure motion). */
  live: boolean;
  ringFires: Readonly<Record<string, number>>;
  /** perf time until which to draw every frame (set by a poll or a resize). */
  busyUntil: number;
}

/** True when nothing is due to move faster than the idle rate can show. */
export function frameDue(now: number, lastDraw: number, busy: boolean): boolean {
  return busy || now - lastDraw >= IDLE_FRAME_MS;
}

const within = (wall: number, at: number, span: number) => wall - at < span;

/** True while an effect, zoom, pulse, idle flip ramp, flare, hover or live worker is in flight. */
export function isBusy(s: PacingState): boolean {
  const { wall, fx } = s;
  if (s.perf < s.busyUntil || s.hover || s.live) return true;
  if (s.perf - s.viewT0 < ZOOM_MS) return true;
  // fx entries are forgotten after KEEP; a spawn or drop may be scheduled in the future (at > wall)
  if (fx.dispatches.some((d) => within(wall, d.at, FX.KEEP))) return true;
  if (fx.ends.some((e) => within(wall, e.at, FX.KEEP))) return true;
  if (Object.values(fx.spawns).some((at) => within(wall, at, FX.SPAWN_TO))) return true;
  if (Object.values(fx.idleFlips).some((at) => at != null && within(wall, at, FX.IDLE_RAMP))) return true;
  if (Object.values(fx.slabDrops).some((d) => d != null && within(wall, d.at, FX.DROP))) return true;
  if (Object.values(s.flares).some((at) => Number.isFinite(at) && within(wall, at, FLARE_WINDOW_MS))) return true;
  if (Object.values(s.ringFires).some((at) => within(wall, at, RING_FIRE_MS))) return true;
  return false;
}

/** How long a changed poll keeps the loop at full rate (eased motion that is not an fx entry). */
export const POLL_WINDOW_MS = 1500;

/**
 * The new `busyUntil` after a poll. Only a poll whose data differs from the last one (or the first poll,
 * `prevKey` null) opens the full-rate window; an identical poll leaves it alone so an idle floor can drop to
 * about 10 fps. Keys are the JSON of the polled data.
 */
export function pollWindowUntil(prevKey: string | null, nextKey: string, now: number, current: number): number {
  return prevKey === nextKey ? current : Math.max(current, now + POLL_WINDOW_MS);
}

/**
 * True while something animates continuously: a running worker (its link's steady flow, pad glow and stage
 * pulse, floorRender `flow` and drawFigure) or a General that is not idle (its route flow). A queued worker
 * alone draws nothing that moves.
 */
export function stateHasLive(state: FloorState | null): boolean {
  if (!state) return false;
  const running = (ws: readonly { status: string }[] | undefined) => !!ws && ws.some((w) => w.status === 'running');
  return running(state.samWorkers) || GENERALS.some((g) => running(state.generals[g.id]?.workers) || state.generals[g.id]?.idle === false);
}
