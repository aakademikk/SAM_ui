/**
 * SAM — figure hit-testing (floor-fixes T11, Must 17, 18).
 *
 * A click or tap within a 44x44px square centred on a worker figure picks its
 * job, and wins over the General's column behind it. Pure.
 */

import type { GeneralId } from '@/types/floor';
import type { Figure } from './floorRender';

export const FIGURE_HIT_PX = 44;
const HALF = FIGURE_HIT_PX / 2;

type HitFigure = Pick<Figure, 'jobId' | 'x' | 'y' | 'returned' | 'vis'>;

/** The jobId of the nearest figure whose centre is within the square of (x, y); fading and invisible figures are ignored. */
export function hitFigure(figures: HitFigure[], x: number, y: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const f of figures) {
    if (f.returned || f.vis <= 0) continue;
    const dx = Math.abs(f.x - x), dy = Math.abs(f.y - y);
    if (dx > HALF || dy > HALF) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { best = f.jobId; bestD = d; }
  }
  return best;
}

export type FloorPick = { kind: 'job'; jobId: string } | { kind: 'general'; id: GeneralId } | null;

/** A figure hit wins over the General's column, else the General, else nothing. */
export function pickAt(figures: HitFigure[], generalHit: GeneralId | null, x: number, y: number): FloorPick {
  const jobId = hitFigure(figures, x, y);
  if (jobId) return { kind: 'job', jobId };
  return generalHit ? { kind: 'general', id: generalHit } : null;
}
