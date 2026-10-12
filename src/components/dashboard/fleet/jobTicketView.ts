/**
 * SAM — job ticket panel view model (job ticket panel, T12).
 *
 * Pure formatters: `JobTicketPanel` data (tickets mode) -> display strings.
 * The component stays thin. `now` is injected. Status labels render exactly
 * as written in the tickets file; nothing is mapped or guessed. Types only
 * are imported from the server module, so no server I/O reaches the client.
 *
 * Spec: must-do 3 to 8; checks 2, 4, 5, 6.
 */

import type { JobTicketPanel } from '@/lib/server/fleet/jobTicketPanel';

export type TicketsData = Extract<JobTicketPanel, { mode: 'tickets' }>;

export const COMMAND_MAX = 80;
export const RECENT_FAILED_SHOWN = 5;

export interface TicketRowView {
  n: number;
  title: string;
  /** The status label as written. */
  label: string;
  /** Running job id, or `stalled: job ended`; null for other labels. */
  claim: string | null;
  stalled: boolean;
}

export interface BuildJobRowView {
  id: string;
  state: string;
  start: string | null;
  end: string | null;
}

export interface FailedRunRowView {
  command: string;
  outcome: string;
}

export interface TicketPanelView {
  heading: string;
  /** The launch summary / job name, shown underneath the heading. */
  name: string | null;
  tickets: TicketRowView[];
  jobs: BuildJobRowView[];
  /** Null when there is no known last event: no line, never a guess. */
  lastActivity: string | null;
  failedHeading: string;
  failedRuns: FailedRunRowView[];
}

/** Same relative-age wording as `formatAge` in JobDetailModule ("5 min"). */
function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Short local time `HH:MM`, or null for a missing or unparsable stamp. */
export function shortTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function trimCommand(command: string): string {
  const one = command.replace(/\s+/g, ' ').trim();
  return one.length > COMMAND_MAX ? `${one.slice(0, COMMAND_MAX - 1)}…` : one;
}

export function formatTicketPanel(data: TicketsData, now: number, name: string | null = null): TicketPanelView {
  const tickets: TicketRowView[] = data.tickets.map((t) => {
    const claim = t.claim;
    return {
      n: t.n,
      title: t.title,
      label: t.label,
      claim: claim ? (claim.stalled ? 'stalled: job ended' : claim.jobId) : null,
      stalled: claim ? claim.stalled : false,
    };
  });

  const jobs: BuildJobRowView[] = data.jobs.map((j) => ({
    id: j.id,
    state: j.state,
    start: shortTime(j.startedAt),
    end: shortTime(j.endedAt),
  }));

  let lastActivity: string | null = null;
  if (data.lastActivity) {
    const at = Date.parse(data.lastActivity);
    if (Number.isFinite(at)) lastActivity = `last activity ${age(now - at)} ago`;
  }

  const failedRuns: FailedRunRowView[] = data.failedRuns.recent.slice(0, RECENT_FAILED_SHOWN).map((r) => ({
    command: trimCommand(r.command),
    outcome: r.exitCode === 124 || r.exitCode === 143 || r.timedOut ? 'timed out' : `exit ${r.exitCode}`,
  }));

  return {
    heading: `${data.done} of ${data.total} tickets done`,
    name,
    tickets,
    jobs,
    lastActivity,
    failedHeading: `${data.failedRuns.count} failed or timed-out test and build runs`,
    failedRuns,
  };
}
