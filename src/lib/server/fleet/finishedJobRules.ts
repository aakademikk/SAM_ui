/**
 * SAM: finished-job row rules (completed-jobs lists, T2).
 *
 * Pure functions over a parsed `meta.json`, with no I/O. Every caller (the
 * store scan, the demo rows, the tests) applies the same rules, so a job is
 * finished, counted and named one way only. `meta` is taken as `unknown` and
 * every field is checked; a malformed value never throws, it simply does not
 * count.
 *
 * Spec: must-dos 4, 5, 7, 9, 10; check 3.
 */

import { FINISHED_GENERALS, type FinishedGeneral, type FinishedOutcome } from '@/types/finishedJobs';

const FINISHED_STATUSES: readonly string[] = ['exited', 'failed', 'killed', 'stopped'];

// sam-job ids end `_<YYYYMMDD-HHMMSS>`, for example
// `job_kitchen-r4-implement-t20_20261008-205319`.
const ID_PREFIX = 'job_';
const TIMESTAMP_TAIL_RE = /_\d{8}-\d{6}$/;

function field(meta: unknown, key: string): unknown {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined;
  return (meta as Record<string, unknown>)[key];
}

/** Finished status and an `endedAt` that parses as a date (must-do 7). */
export function isFinishedMeta(meta: unknown): boolean {
  const status = field(meta, 'status');
  if (typeof status !== 'string' || !FINISHED_STATUSES.includes(status)) return false;
  const endedAt = field(meta, 'endedAt');
  return typeof endedAt === 'string' && endedAt.trim() !== '' && !Number.isNaN(Date.parse(endedAt));
}

/**
 * The job's own outcome (must-do 9). Only meaningful once `isFinishedMeta`
 * holds; any other status reads as failed, so a malformed job is never shown
 * as a clean pass.
 */
export function outcomeOf(meta: unknown): FinishedOutcome {
  const status = field(meta, 'status');
  if (status === 'exited') return field(meta, 'exitCode') === 0 ? 'passed' : 'failed';
  if (status === 'killed' || status === 'stopped') return 'stopped';
  return 'failed';
}

/** The counted General, or null when `general` is null, absent, non-string or unknown (must-do 10). */
export function countedGeneral(meta: unknown): FinishedGeneral | null {
  const general = field(meta, 'general');
  if (typeof general !== 'string') return null;
  return (FINISHED_GENERALS as readonly string[]).includes(general)
    ? (general as FinishedGeneral)
    : null;
}

/** The id without the `job_` prefix and the timestamp tail (must-do 5). */
export function slugOf(id: string): string {
  const bare = id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : id;
  const slug = bare.replace(TIMESTAMP_TAIL_RE, '');
  return slug === '' ? id : slug;
}

/** `summary` when non-empty after trimming, else the slug. Never reads `command` (must-dos 4, 5). */
export function nameOf(id: string, meta: unknown): string {
  const summary = field(meta, 'summary');
  if (typeof summary === 'string' && summary.trim() !== '') return summary.trim();
  return slugOf(id);
}
