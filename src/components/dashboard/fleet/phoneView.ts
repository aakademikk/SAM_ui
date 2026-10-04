/**
 * SAM — the phone layout's pure half (T13, Must 6a to 6c).
 *
 * Kept free of the DOM so `phoneView.test.ts` can run it headlessly:
 * - which layout a page gets (`chooseFleetView`): the mockup's media-query
 *   gate (`PHONE_QUERY`, shared with `dashboardLayout.ts`) plus its
 *   `?view=phone` / `?view=desktop` override for testing;
 * - the one bottom sheet open at a time (`phoneSheetReducer`): a General's
 *   detail or the Ask SAM chat;
 * - when a swipe down closes the sheet (`sheetReleaseCloses`);
 * - the hero caption and the job in flight's stage timeline, from the real
 *   `FloorWorker` only (Must 8, 17: never an invented stage).
 */

import type { FloorState, FloorStage, FloorWorker, GeneralId } from '@/types/floor';

export { PHONE_QUERY } from './dashboardLayout';

/* ---------- which layout ---------- */

export type FleetViewKind = 'desktop' | 'phone';

/** The mockup's override, `?view=phone` or `?view=desktop` (same regex as e-hybrid.html / e-phone.html). */
export function viewOverride(search: string): FleetViewKind | null {
  const m = /[?&]view=(phone|desktop)(&|$)/.exec(search);
  return m ? (m[1] as FleetViewKind) : null;
}

/** The override if there is one, else the phone layout exactly when `PHONE_QUERY` matches. */
export function chooseFleetView(search: string, phoneQueryMatches: boolean): FleetViewKind {
  return viewOverride(search) ?? (phoneQueryMatches ? 'phone' : 'desktop');
}

/* ---------- the bottom sheet ---------- */

/** At most one sheet: a General's detail (Must 6b), the Ask SAM chat (T14), or (T18) the Schedule panel. */
export type PhoneSheet = { kind: 'general'; id: GeneralId } | { kind: 'chat' } | { kind: 'schedule' } | null;

export type PhoneSheetAction =
  | { type: 'openGeneral'; id: GeneralId }
  | { type: 'openChat' }
  /** A tap on the ring's click target (T18, Must 26). */
  | { type: 'openSchedule' }
  | { type: 'close' }
  /** A tap on the hero: a General opens its sheet; empty floor leaves things as they are (the scrim covers the hero while a sheet is open). */
  | { type: 'heroTap'; hit: GeneralId | null }
  /** A job was picked (an Active jobs row or a figure): every sheet closes so the job panel behind shows. */
  | { type: 'selectJob' };

export function phoneSheetReducer(state: PhoneSheet, action: PhoneSheetAction): PhoneSheet {
  switch (action.type) {
    case 'openGeneral':
      return state?.kind === 'general' && state.id === action.id ? state : { kind: 'general', id: action.id };
    case 'openChat':
      return state?.kind === 'chat' ? state : { kind: 'chat' };
    case 'openSchedule':
      return state?.kind === 'schedule' ? state : { kind: 'schedule' };
    case 'close':
      return null;
    case 'heroTap':
      return action.hit ? phoneSheetReducer(state, { type: 'openGeneral', id: action.hit }) : state;
    case 'selectJob':
      return null;
  }
}

/** Scrolling the job panel into view is instant under reduced motion. */
export function scrollBehaviorFor(reducedMotion: boolean): 'auto' | 'smooth' {
  return reducedMotion ? 'auto' : 'smooth';
}

/** Swipe-down: past this many px, or a quick flick, closes the sheet; otherwise it springs back. */
export const SHEET_CLOSE_PX = 90;
export const SHEET_FLICK_PX = 24;
export const SHEET_FLICK_PX_PER_MS = 0.5;

/** How far the sheet follows a finger dragged `dy` px (down only; an upward drag doesn't lift it). */
export function sheetDragOffset(dy: number): number {
  return Math.max(0, dy);
}

/** Whether letting go after dragging `dy` px down over `ms` closes the sheet. */
export function sheetReleaseCloses(dy: number, ms: number): boolean {
  if (dy >= SHEET_CLOSE_PX) return true;
  return dy >= SHEET_FLICK_PX && dy / Math.max(1, ms) >= SHEET_FLICK_PX_PER_MS;
}

/* ---------- the job in flight ---------- */

const GENERAL_NAMES: Record<GeneralId, string> = {
  hermes: 'Hermes', hephaestus: 'Hephaestus', calliope: 'Calliope', cerberus: 'Cerberus', prometheus: 'Prometheus',
};

export function ownerName(general: GeneralId | 'sam'): string {
  return general === 'sam' ? 'SAM' : GENERAL_NAMES[general];
}

/**
 * The hero's caption chip (the mockup's `captionFor`), for the job in flight
 * (the one Job detail shows): "<General> · <stage>" while a stage is lit,
 * "<General> · running" when it has no stage events, "SAM queued a job for
 * <General>" while queued, "<General> · failed" for a failed (red) job.
 */
export function heroCaption(state: FloorState | null, w: FloorWorker | null): string {
  if (!state) return 'Connecting to the fleet';
  if (!w) return 'No jobs running';
  const who = ownerName(w.general);
  if (w.status === 'queued') return w.general === 'sam' ? 'SAM queued a job' : `SAM queued a job for ${who}`;
  if (w.status === 'failed') return `${who} · failed`;
  const now = w.stages?.find((s) => s.state === 'now');
  return now ? `${who} · ${now.name}` : `${who} · running`;
}

/** Any worker on the floor by job id (a failed one too), as Job detail finds it. */
export function findFloorWorker(state: FloorState | null, jobId: string | null): FloorWorker | null {
  if (!state || !jobId) return null;
  for (const general of Object.keys(GENERAL_NAMES) as GeneralId[]) {
    const hit = state.generals[general].workers.find((w) => w.jobId === jobId);
    if (hit) return hit;
  }
  return state.samWorkers.find((w) => w.jobId === jobId) ?? null;
}

export const LIFECYCLE = ['Queued', 'Dispatched', 'Running', 'Verifying', 'Done'] as const;
export type LifeStep = 'done' | 'now' | 'bad' | '';

/**
 * The mockup's lifecycle row (`.life`), from the worker's real status: queued
 * is step 0; running has been dispatched (step 2); 'verifying' is step 3;
 * done is all five; a failed job shows every step up to Running done and
 * the last step red.
 */
export function lifecycleSteps(status: FloorWorker['status']): LifeStep[] {
  const at = status === 'queued' ? 0 : status === 'running' ? 2 : status === 'verifying' ? 3 : 4;
  if (status === 'done') return LIFECYCLE.map(() => 'done');
  if (status === 'failed') return LIFECYCLE.map((_, i) => (i < 3 ? 'done' : i === 4 ? 'bad' : ''));
  return LIFECYCLE.map((_, i) => (i < at ? 'done' : i === at ? 'now' : ''));
}

export interface StageTimeline {
  /** The job's real stages in planned order, or null when it has none (Must 17). */
  stages: FloorStage[] | null;
  /** "2 of 5 stages", or the honest note when there are no stage events. */
  summary: string;
}

export function stageTimeline(w: FloorWorker): StageTimeline {
  if (!w.stages || w.stages.length === 0) return { stages: null, summary: 'No stage events' };
  const done = w.stages.filter((s) => s.state === 'done').length;
  return { stages: w.stages, summary: `${done} of ${w.stages.length} stages` };
}
