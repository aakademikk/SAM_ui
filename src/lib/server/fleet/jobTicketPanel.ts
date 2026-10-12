/**
 * SAM — job ticket panel data assembler (job ticket panel, T10).
 *
 * One server function builds everything the detail panel needs for a job id:
 * the tickets (in file order, with claim state for IN PROGRESS ones), the live
 * heading counts, the build's jobs, last activity and failed runs. Jobs that
 * are not ticket jobs get `{ mode: 'stages' }` so the component keeps today's
 * view. The job id comes from outside, so it is validated and the resolved
 * path must stay inside the jobs root.
 *
 * Spec: must-do 2 to 10; checks 1, 4, 7.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readBuildJobs, type BuildJob } from '@/lib/server/fleet/buildLog';
import { failedRuns, lastActivity, readStreamTail, type FailedRun } from '@/lib/server/fleet/streamTail';
import { resolveTicketJob } from '@/lib/server/fleet/ticketJob';
import { readTicketsFile, ticketProgress, type Ticket } from '@/lib/server/fleet/ticketsFile';

export const MISSING_NOTICE = 'Tickets file not found (worktree removed?): showing stages.';
/** An ended job still shows last activity for this long. */
export const RECENT_END_MS = 30 * 60 * 1000;

const JOB_ID_RE = /^job_[A-Za-z0-9._-]+$/;

export interface TicketClaim {
  jobId: string;
  running: boolean;
  /** True when the claiming job is not running or its folder is gone. */
  stalled: boolean;
}

export interface PanelTicket extends Ticket {
  /** Set only for IN PROGRESS tickets that name a claiming job. */
  claim: TicketClaim | null;
}

export type JobTicketPanel =
  | { mode: 'stages'; notice?: string }
  | {
      mode: 'tickets';
      ticketsPath: string;
      tickets: PanelTicket[];
      done: number;
      total: number;
      heading: string;
      jobs: BuildJob[];
      lastActivity: string | null;
      failedRuns: { count: number; recent: FailedRun[] };
    };

/** Resolves a job folder under the jobs root, or null when the id is unsafe. */
function jobDirFor(jobId: string): string | null {
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) return null;
  const root = resolve(join(homedir(), '.sam', 'jobs'));
  const dir = resolve(root, jobId);
  return dir.startsWith(root + sep) && dir !== root ? dir : null;
}

interface JobState {
  status: string | null;
  endedAt: string | null;
}

async function readJobState(dir: string): Promise<JobState | null> {
  try {
    const m = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { status?: unknown; endedAt?: unknown } | null;
    if (!m || typeof m !== 'object') return null;
    return {
      status: typeof m.status === 'string' ? m.status : null,
      endedAt: typeof m.endedAt === 'string' ? m.endedAt : null,
    };
  } catch {
    return null;
  }
}

const isRunning = (s: JobState | null): boolean => s !== null && (s.status === 'running' || s.status === 'queued');

async function claimFor(ticket: Ticket): Promise<TicketClaim | null> {
  if (ticket.label.toLowerCase() !== 'in progress' || !ticket.claimJobId) return null;
  const jobId = ticket.claimJobId;
  const dir = jobDirFor(jobId);
  const state = dir ? await readJobState(dir) : null;
  const running = isRunning(state);
  return { jobId, running, stalled: !running };
}

export async function readJobTicketPanel(jobId: string): Promise<JobTicketPanel> {
  const dir = jobDirFor(jobId);
  if (!dir) return { mode: 'stages' };

  const tj = await resolveTicketJob(dir);
  if (tj.kind === 'none') return { mode: 'stages' };
  if (tj.kind === 'missing') return { mode: 'stages', notice: MISSING_NOTICE };

  const parsed = await readTicketsFile(tj.ticketsPath);
  if (parsed === null) return { mode: 'stages', notice: MISSING_NOTICE };

  const tickets: PanelTicket[] = [];
  for (const t of parsed) tickets.push({ ...t, claim: await claimFor(t) });
  const { done, total } = ticketProgress(parsed);

  const state = await readJobState(dir);
  const endedMs = state?.endedAt ? Date.parse(state.endedAt) : Number.NaN;
  const recent = isRunning(state) || (Number.isFinite(endedMs) && Date.now() - endedMs <= RECENT_END_MS);
  // Always read the (bounded) tail: failed runs stay listed for old jobs.
  // Only lastActivity is limited to running or recently ended jobs.
  const lines = await readStreamTail(join(dir, 'claude-stream.jsonl'));
  const activity: string | null = recent ? lastActivity(lines) : null;
  const failed = failedRuns(lines);

  return {
    mode: 'tickets',
    ticketsPath: tj.ticketsPath,
    tickets,
    done,
    total,
    heading: `${done} of ${total} tickets done`,
    jobs: await readBuildJobs(tj.ticketsPath),
    lastActivity: activity,
    failedRuns: failed,
  };
}
