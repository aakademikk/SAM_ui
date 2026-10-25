/**
 * SAM: Finished-job types (completed-jobs lists, T2).
 *
 * One row shape shared by the server read, the demo rows and the UI, so the
 * fleet list and each General's "Last 5 finished" cannot disagree. A row
 * carries no command, model or cost (spec section 3): only what the row shows.
 *
 * Spec: must-dos 4, 5, 7, 9, 10.
 */

import type { GeneralId } from '@/types/floor';

/** The job's own outcome (must-do 9). */
export type FinishedOutcome = 'passed' | 'failed' | 'stopped';

/** Whose job it was. `'sam'` is SAM's own job; the UI labels it "SAM". */
export type FinishedGeneral = GeneralId | 'sam';

export interface FinishedJob {
  id: string;
  /** `meta.json` `summary`, else the id's slug. Never the command. */
  name: string;
  general: FinishedGeneral;
  /** `meta.json` `endedAt`, verbatim; always parses as a date. */
  endedAt: string;
  outcome: FinishedOutcome;
  /** The closer's verdict string, or null for "not checked". */
  verdict: string | null;
}

/**
 * The only `general` values that count (must-do 10). A null, absent or
 * unknown `general` never counts, unlike the floor's `resolveGeneral`.
 */
export const FINISHED_GENERALS: readonly FinishedGeneral[] = [
  'hermes',
  'hephaestus',
  'calliope',
  'cerberus',
  'prometheus',
  'sam',
];

/** Rows on the fleet list. */
export const FLEET_LIST_CAP = 10;

/** Rows on a General's panel. */
export const GENERAL_LIST_CAP = 5;
