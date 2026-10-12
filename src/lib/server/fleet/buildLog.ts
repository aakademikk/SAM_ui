/**
 * SAM — build log reader (job ticket panel, T9).
 *
 * Merges `~/.sam/builds/<stem>-<h8>.jsonl` (one dispatch line per ticket job,
 * one end line from the Job Closer) with whatever job folders still exist for
 * the same tickets file, newest first. A job whose folder was pruned is built
 * from its log lines; when the folder exists, `meta.json` wins.
 *
 * Spec: must-do 4, 16; check 3.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { resolveTicketJob } from '@/lib/server/fleet/ticketJob';

export type BuildJobState = 'running' | 'done' | 'failed' | 'ended, outcome unknown';

export interface BuildJob {
  id: string;
  state: BuildJobState;
  /** ISO start time, or null when neither meta nor log knows it. */
  startedAt: string | null;
  /** ISO end time, or null while running / unknown. */
  endedAt: string | null;
  /** True when the job folder still exists (meta.json was the source). */
  folder: boolean;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** `<home>/.sam/builds/<stem>-<h8>.jsonl`; env SAM_BUILDS_DIR is not used here (TS reads HOME). */
export function buildLogPath(ticketsPath: string, homeDir: string = homedir()): string {
  const real = safeRealpath(ticketsPath);
  const h8 = createHash('sha1').update(real).digest('hex').slice(0, 8);
  const stem = basename(ticketsPath).replace(/\.md$/, '');
  return join(homeDir, '.sam', 'builds', `${stem}-${h8}.jsonl`);
}

interface LogEntry {
  jobId: string;
  dispatchAt: string | null;
  endAt: string | null;
  verdict: string | null;
}

async function readLog(path: string): Promise<Map<string, LogEntry>> {
  const out = new Map<string, LogEntry>();
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    if (typeof r.jobId !== 'string' || !r.jobId) continue;
    const e = out.get(r.jobId) ?? { jobId: r.jobId, dispatchAt: null, endAt: null, verdict: null };
    const at = typeof r.at === 'string' ? r.at : null;
    if (r.kind === 'dispatch') e.dispatchAt = at;
    else if (r.kind === 'end') {
      e.endAt = at;
      e.verdict = typeof r.verdict === 'string' ? r.verdict : '';
    } else continue;
    out.set(r.jobId, e);
  }
  return out;
}

interface Meta {
  status?: unknown;
  exitCode?: unknown;
  startedAt?: unknown;
  createdAt?: unknown;
  endedAt?: unknown;
}

async function readMeta(jobDir: string): Promise<Meta | null> {
  try {
    const m = JSON.parse(await readFile(join(jobDir, 'meta.json'), 'utf8')) as unknown;
    return m && typeof m === 'object' ? (m as Meta) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function fromMeta(id: string, m: Meta, log: LogEntry | undefined): BuildJob {
  const status = str(m.status);
  const endedAt = str(m.endedAt) ?? (status === 'running' || status === 'queued' ? null : log?.endAt ?? null);
  let state: BuildJobState;
  if (status === 'running' || status === 'queued') state = 'running';
  else if (status === 'exited' && (m.exitCode === 0 || m.exitCode === undefined || m.exitCode === null)) state = 'done';
  else state = 'failed';
  return {
    id,
    state,
    startedAt: str(m.startedAt) ?? str(m.createdAt) ?? log?.dispatchAt ?? null,
    endedAt,
    folder: true,
  };
}

function fromLog(e: LogEntry): BuildJob {
  let state: BuildJobState;
  if (e.endAt === null) state = 'ended, outcome unknown';
  else state = (e.verdict ?? '').startsWith('PASS') ? 'done' : 'failed';
  return { id: e.jobId, state, startedAt: e.dispatchAt, endedAt: e.endAt, folder: false };
}

function sortKey(j: BuildJob): number {
  const t = j.startedAt ? Date.parse(j.startedAt) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
}

export async function readBuildJobs(ticketsPath: string): Promise<BuildJob[]> {
  const home = homedir();
  const jobsRoot = join(home, '.sam', 'jobs');
  const log = await readLog(buildLogPath(ticketsPath, home));
  const wantReal = safeRealpath(ticketsPath);

  const jobs = new Map<string, BuildJob>();

  // Jobs named in the log: folder (if any) wins, else the log lines.
  for (const [id, entry] of log) {
    const m = await readMeta(join(jobsRoot, id));
    jobs.set(id, m ? fromMeta(id, m, entry) : fromLog(entry));
  }

  // Job folders for the same tickets file that the log does not name.
  let names: string[] = [];
  try {
    names = (await readdir(jobsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('job_'))
      .map((d) => d.name);
  } catch {
    /* no jobs dir */
  }
  for (const id of names) {
    if (jobs.has(id)) continue;
    const dir = join(jobsRoot, id);
    const tj = await resolveTicketJob(dir);
    if (tj.kind !== 'ok' || safeRealpath(tj.ticketsPath) !== wantReal) continue;
    const m = await readMeta(dir);
    if (m) jobs.set(id, fromMeta(id, m, undefined));
  }

  return [...jobs.values()].sort((a, b) => sortKey(b) - sortKey(a) || (a.id < b.id ? 1 : -1));
}
