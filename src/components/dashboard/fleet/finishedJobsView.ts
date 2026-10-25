/**
 * SAM: finished-jobs display helpers (completed-jobs T7).
 *
 * The pure half of `FinishedJobsList`: what one row says. The fleet list, each
 * General's "Last 5 finished" and the phone sheet all render through these, so
 * the outcome, verdict and "not checked" rules cannot drift between them.
 *
 * Rules (spec must-dos 4, 5, 14, 15, 19):
 *   - With a closer verdict, the verdict is shown word for word. The job's own
 *     outcome is added in smaller text when it disagrees with the verdict's
 *     kind (PASS against a job that did not pass, FAIL against one that did),
 *     and always for UNKNOWN, which asserts nothing. A bad job is never shown
 *     as a clean pass.
 *   - With no verdict, the job's own outcome is shown with "not checked".
 *   - Times are UTC `HH:MM`, to agree with the top bar clock (same format as
 *     `hhmmUtc` in `GeneralDetailPanel.tsx`), with `DD MMM` in front when the
 *     finish is not on today's UTC date.
 *
 * No server imports: this runs in the browser.
 */

import type { FinishedJob, FinishedOutcome } from '@/types/finishedJobs';
import type { GeneralId } from '@/types/floor';

/** Poll period for both lists; paused while the tab is hidden. */
export const FINISHED_POLL_MS = 10_000;

/** Display names, restated from `GeneralDetailPanel.tsx` `GENERAL_INFO` (the same choice `FleetStatusModule` made). */
export const GENERAL_NAMES: Record<GeneralId, string> = {
  hermes: 'Hermes',
  hephaestus: 'Hephaestus',
  calliope: 'Calliope',
  cerberus: 'Cerberus',
  prometheus: 'Prometheus',
};

export const OUTCOME_WORDS: Record<FinishedOutcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The request both lists poll: the fleet list, or one General's last five. */
export function finishedJobsUrl(general: GeneralId | undefined, demo: boolean): string {
  const params: string[] = [];
  if (general) params.push(`general=${encodeURIComponent(general)}`);
  if (demo) params.push('demo=1');
  return '/api/fleet/finished-jobs' + (params.length ? `?${params.join('&')}` : '');
}

/** `HH:MM` UTC, with `DD MMM ` in front when not on `now`'s UTC date. */
export function finishedWhen(endedAt: string, now: number): string {
  const t = Date.parse(endedAt);
  if (!Number.isFinite(t)) return '--:--';
  const d = new Date(t);
  const hhmm = d.toISOString().slice(11, 16);
  if (d.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10)) return hhmm;
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${hhmm}`;
}

/** What a verdict claims: PASS and FAIL claim an outcome, UNKNOWN (or anything else) claims none. */
function verdictKind(verdict: string): FinishedOutcome | null {
  const v = verdict.trim();
  if (v.startsWith('PASS')) return 'passed';
  if (v.startsWith('FAIL')) return 'failed';
  return null;
}

export interface FinishedRowLabels {
  name: string;
  /** The General's display name, or "SAM". */
  generalLabel: string;
  when: string;
  /** The verdict word for word, or the job's own outcome word when there is none. */
  primary: string;
  /** The job's own outcome word, when it disagrees with the verdict; else null. */
  secondary: string | null;
  /** True when the row has no valid closer verdict (must-do 19). */
  notChecked: boolean;
}

export function rowLabels(job: FinishedJob, now: number): FinishedRowLabels {
  const base = {
    name: job.name,
    generalLabel: job.general === 'sam' ? 'SAM' : GENERAL_NAMES[job.general],
    when: finishedWhen(job.endedAt, now),
  };
  const own = OUTCOME_WORDS[job.outcome];
  if (job.verdict === null) return { ...base, primary: own, secondary: null, notChecked: true };
  return {
    ...base,
    primary: job.verdict,
    secondary: verdictKind(job.verdict) === job.outcome ? null : own,
    notChecked: false,
  };
}

/** Pill colour: what the primary word says. A stopped job or an UNKNOWN verdict is neither good nor bad. */
export function primaryTone(job: FinishedJob): 'ok' | 'bad' | 'neutral' {
  const kind = job.verdict === null ? job.outcome : verdictKind(job.verdict);
  return kind === 'passed' ? 'ok' : kind === 'failed' ? 'bad' : 'neutral';
}

/** The row link's accessible name: everything the row shows, with the verdict in full. */
export function rowAriaLabel(l: FinishedRowLabels, showGeneral: boolean): string {
  const parts = [l.name];
  if (showGeneral) parts.push(l.generalLabel);
  parts.push(`finished ${l.when} UTC`, l.primary);
  if (l.secondary) parts.push(`job's own outcome ${l.secondary}`);
  if (l.notChecked) parts.push('not checked');
  return parts.join(', ');
}
