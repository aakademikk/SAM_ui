/**
 * SAM — which job Job detail shows (floor-fixes T11, Must 13, 16, 19).
 *
 * A job is pickable while it has a figure on the floor: queued, running, or
 * recently failed (the red figure held on its pads). The picked job stays
 * shown while pickable; otherwise Job detail falls back to the first live job.
 * Pure: `now` is a parameter so tests are deterministic.
 */

import type { FloorState } from '@/types/floor';
import { GENERALS, figureWorkers } from '@/components/floor/floorRender';
import { activeJobEntries } from './ActiveJobsModule';

/** Every job with a figure (queued, running, recently failed), the Generals in floor order, then SAM. */
export function pickableJobIds(state: FloorState | null, now: number): string[] {
  if (!state) return [];
  const ids: string[] = [];
  for (const g of GENERALS) {
    for (const w of figureWorkers(state.generals[g.id]?.workers ?? [], now)) ids.push(w.jobId);
  }
  for (const w of figureWorkers(state.samWorkers ?? [], now)) ids.push(w.jobId);
  return ids;
}

/** The selected job while it is pickable, else the first live job, else null. */
export function resolveJobId(state: FloorState | null, selectedJobId: string | null, now: number): string | null {
  if (selectedJobId && pickableJobIds(state, now).includes(selectedJobId)) return selectedJobId;
  return activeJobEntries(state)[0]?.worker.jobId ?? null;
}
