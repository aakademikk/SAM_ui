/**
 * SAM: finished-jobs store scan (completed-jobs lists, T4).
 *
 * Builds the fleet list (last 10 finished across the five Generals and SAM)
 * and each General's last 5 from `~/.sam/jobs`, without re-reading the store
 * on every poll. A poller that re-read files in full every few seconds drove
 * the server towards its memory ceiling (SAM_ui memory, 2026-10-07), so this
 * follows `claudeCosts.ts`, not `floorState.ts` `listRecentJobIds` (a `stat`
 * on every directory on every poll):
 *
 *   - One `readdir` per scan. Every `job_` directory is remembered in a map:
 *     `skip` (not a sam-job job, or finished with an uncounted `general`),
 *     `running` (re-read next scan) or `finished` (read once, kept).
 *   - Only new and `running` directories are read: one `meta.json` open each,
 *     at most MAX_INFLIGHT_OPENS in flight, at most MAX_READ_BYTES read.
 *     `cmd.sh` is checked (one `access`) only once `meta.json` says the job is
 *     finished or running with a counted `general`, so a chat turn costs one
 *     `meta.json` open and nothing more.
 *   - Entries whose directory has gone are dropped, so the map shrinks with
 *     the store.
 *   - The whole scan is memoised for MEMO_TTL_MS, with one shared in-flight
 *     promise, so pollers together cost a single scan.
 *
 * The scan touches only `meta.json` and `cmd.sh`. No job output, stream log
 * or cost lookup is read to build these rows. Scan rows carry `verdict: null`.
 *
 * Verdicts (T5): `getFleetFinished` and `getGeneralFinished` attach the
 * closer's verdict to the capped rows only (at most 10, or 5), so the closer
 * record is read for rows being returned and only once `meta.json` has said
 * the job is finished. Each verdict is remembered with its record's mtime: a
 * later call costs one `stat` and re-reads only when the mtime has changed.
 * "No record" is remembered for MEMO_TTL_MS only, so a record that appears
 * after the job finished shows on the next poll past the scan memo.
 *
 * Spec: must-dos 7, 8, 10, 13, 14, 15, 16; checks 1, 2, 5, 6, 8, 9.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FLEET_LIST_CAP,
  GENERAL_LIST_CAP,
  type FinishedJob,
} from '@/types/finishedJobs';
import type { GeneralId } from '@/types/floor';

import { CLOSER_FILE, MAX_READ_BYTES, readCloserVerdict } from '@/lib/server/fleet/closerRecord';
import { countedGeneral, isFinishedMeta, nameOf, outcomeOf } from '@/lib/server/fleet/finishedJobRules';

/** Most files open at once during a scan (must-do 13). */
export const MAX_INFLIGHT_OPENS = 16;

/** A scan is shared and reused for this long after it completes. */
export const MEMO_TTL_MS = 2000;

/**
 * A directory whose `meta.json` is missing or unparseable is retried while
 * its id says it is younger than this (a half-written file), then skipped for
 * good (a broken one is not retried forever).
 */
const RETRY_UNREADABLE_MS = 10 * 60 * 1000;

const ID_PREFIX = 'job_';
const META_FILE = 'meta.json';
// sam-job writes cmd.sh before meta.json, so once meta.json is readable a
// missing cmd.sh means the directory is not a sam-job job (a chat turn).
const CMD_FILE = 'cmd.sh';

// sam-job ids end `_<YYYYMMDD-HHMMSS>` in UTC (`date -u`). Chat-turn ids do
// not; they never count, so skipping an unreadable one at once loses nothing.
const ID_STAMP_RE = /_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

type StoredJob = Omit<FinishedJob, 'verdict'>;

type Entry =
  | { kind: 'skip' }
  /** `samJob` is true once `cmd.sh` has been seen, so it is not checked again. */
  | { kind: 'running'; samJob: boolean }
  | { kind: 'finished'; job: StoredJob; endedMs: number };

export interface FinishedScan {
  /** Up to FLEET_LIST_CAP rows, newest `endedAt` first, including SAM's own jobs. */
  fleet: FinishedJob[];
  /** Up to GENERAL_LIST_CAP rows for one General, newest first, never SAM's. */
  byGeneral: (id: GeneralId) => FinishedJob[];
}

const SKIP: Entry = { kind: 'skip' };

/**
 * A row's last closer read: a valid verdict with its record's mtime, or "no
 * record" with when it was read.
 */
type VerdictEntry = { verdict: string; mtimeMs: number } | { verdict: null; readAt: number };

let entries = new Map<string, Entry>();
let verdicts = new Map<string, VerdictEntry>();
let lastScan: { at: number; result: FinishedScan } | null = null;
let inFlight: Promise<FinishedScan> | null = null;

/** Resolved at call time, not module load, so tests can point HOME elsewhere. */
function jobsRoot(): string {
  return path.join(os.homedir(), '.sam', 'jobs');
}

/** Clears the remembered store and the memo. For tests. */
export function resetFinishedJobsCache(): void {
  entries = new Map();
  verdicts = new Map();
  lastScan = null;
  inFlight = null;
}

/** Test seam: expire the memo without forgetting the store, and see the map's size. */
export const finishedJobsTestHooks = {
  expireMemo(): void {
    lastScan = null;
  },
  cacheSize(): number {
    return entries.size;
  },
  verdictCacheSize(): number {
    return verdicts.size;
  },
};

/**
 * The finished-job lists, from a memoised incremental scan of the store.
 * A call within MEMO_TTL_MS of the last completed scan returns its result
 * without touching the disk; concurrent calls share one scan.
 */
export function scanFinishedJobs(): Promise<FinishedScan> {
  if (lastScan && Date.now() - lastScan.at < MEMO_TTL_MS) return Promise.resolve(lastScan.result);
  if (inFlight) return inFlight;
  const run = scanStore().then((result) => {
    lastScan = { at: Date.now(), result };
    return result;
  });
  inFlight = run;
  run
    .finally(() => {
      if (inFlight === run) inFlight = null; // never memoise a failure
    })
    .catch(() => {});
  return run;
}

async function scanStore(): Promise<FinishedScan> {
  const root = jobsRoot();
  let names: string[];
  try {
    names = await fsp.readdir(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    names = []; // no store yet: nothing to remember
  }

  const present = new Set(names.filter((name) => name.startsWith(ID_PREFIX)));
  for (const name of entries.keys()) {
    if (!present.has(name)) entries.delete(name);
  }
  for (const name of verdicts.keys()) {
    if (!present.has(name)) verdicts.delete(name);
  }

  const toRead: string[] = [];
  for (const name of present) {
    const entry = entries.get(name);
    if (entry === undefined || entry.kind === 'running') toRead.push(name);
  }

  // A fixed pool of workers, so at most MAX_INFLIGHT_OPENS files are open at
  // once. Each worker reads into its own buffer, reused across its files.
  let next = 0;
  const worker = async () => {
    const buf = Buffer.allocUnsafe(MAX_READ_BYTES);
    while (next < toRead.length) {
      const name = toRead[next++];
      entries.set(name, await classify(root, name, entries.get(name), buf));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_INFLIGHT_OPENS, toRead.length) }, worker),
  );

  return buildResult();
}

/** One directory's entry, from one `meta.json` read and at most one `cmd.sh` check. */
async function classify(
  root: string,
  name: string,
  prior: Entry | undefined,
  buf: Buffer,
): Promise<Entry> {
  const dir = path.join(root, name);
  const meta = await readMeta(path.join(dir, META_FILE), buf);
  if (meta === null) return isYoung(name) ? { kind: 'running', samJob: false } : SKIP;

  const general = countedGeneral(meta);
  const finished = isFinishedMeta(meta);
  if (general === null) return finished ? SKIP : { kind: 'running', samJob: false };

  const samJob = (prior?.kind === 'running' && prior.samJob) || (await hasCmdFile(dir));
  if (!samJob) return SKIP;
  if (!finished) return { kind: 'running', samJob: true };

  const endedAt = meta.endedAt as string; // isFinishedMeta checked it parses
  return {
    kind: 'finished',
    job: { id: name, name: nameOf(name, meta), general, endedAt, outcome: outcomeOf(meta) },
    endedMs: Date.parse(endedAt),
  };
}

/**
 * Parsed `meta.json` as an object, or null when missing, unreadable or not an
 * object. Reads at most MAX_READ_BYTES: a larger file is cut short, fails to
 * parse and so counts as unreadable.
 */
async function readMeta(file: string, buf: Buffer): Promise<Record<string, unknown> | null> {
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(file, 'r');
    let filled = 0;
    while (filled < buf.length) {
      const { bytesRead } = await handle.read(buf, filled, buf.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    const parsed: unknown = JSON.parse(buf.toString('utf-8', 0, filled));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function hasCmdFile(dir: string): Promise<boolean> {
  try {
    await fsp.access(path.join(dir, CMD_FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the id's sam-job timestamp is within RETRY_UNREADABLE_MS of now.
 * Bounded on both sides, so a stamp far in the future is not retried forever.
 */
function isYoung(id: string): boolean {
  const m = ID_STAMP_RE.exec(id);
  if (!m) return false;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const age = Date.now() - Date.UTC(y, mo - 1, d, h, mi, s);
  return Math.abs(age) < RETRY_UNREADABLE_MS;
}

function buildResult(): FinishedScan {
  const finished: { job: StoredJob; endedMs: number }[] = [];
  for (const entry of entries.values()) {
    if (entry.kind === 'finished') finished.push(entry);
  }
  // Newest finish first (never creation time); ties by id, descending.
  finished.sort((a, b) => b.endedMs - a.endedMs || (a.job.id < b.job.id ? 1 : a.job.id > b.job.id ? -1 : 0));
  const sorted = finished.map((f) => f.job);

  const row = (job: StoredJob): FinishedJob => ({ ...job, verdict: null });
  return {
    fleet: sorted.slice(0, FLEET_LIST_CAP).map(row),
    byGeneral: (id) => sorted.filter((job) => job.general === id).slice(0, GENERAL_LIST_CAP).map(row),
  };
}

/** The fleet list, newest finish first, with closer verdicts attached. */
export async function getFleetFinished(): Promise<FinishedJob[]> {
  const { fleet } = await scanFinishedJobs();
  return attachVerdicts(fleet);
}

/** One General's last finished jobs, newest first, with closer verdicts attached. */
export async function getGeneralFinished(id: GeneralId): Promise<FinishedJob[]> {
  const { byGeneral } = await scanFinishedJobs();
  return attachVerdicts(byGeneral(id));
}

/**
 * Copies of `rows` with `verdict` set from each job's closer record, or null
 * for "no record". At most MAX_INFLIGHT_OPENS rows are looked up at once.
 * Never rejects: a row whose lookup fails keeps `verdict: null`.
 */
export async function attachVerdicts(rows: FinishedJob[]): Promise<FinishedJob[]> {
  const root = jobsRoot();
  const out = rows.map((row): FinishedJob => ({ ...row, verdict: null }));
  let next = 0;
  const worker = async () => {
    while (next < out.length) {
      const row = out[next++];
      try {
        row.verdict = await verdictFor(root, row.id);
      } catch {
        row.verdict = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_INFLIGHT_OPENS, out.length) }, worker));
  return out;
}

/** One row's verdict: from memory when still current, else one closer read. */
async function verdictFor(root: string, id: string): Promise<string | null> {
  const dir = path.join(root, id);
  const known = verdicts.get(id);
  if (known?.verdict === null && Date.now() - known.readAt < MEMO_TTL_MS) return null;
  if (known && known.verdict !== null) {
    const mtimeMs = await closerMtime(dir);
    if (mtimeMs === known.mtimeMs) return known.verdict;
    if (mtimeMs === null) {
      // The record has gone: "no record", with no open needed to learn it.
      verdicts.set(id, { verdict: null, readAt: Date.now() });
      return null;
    }
  }
  const record = await readCloserVerdict(dir);
  verdicts.set(id, record ?? { verdict: null, readAt: Date.now() });
  return record?.verdict ?? null;
}

/** The closer record's mtime from one `stat`, or null when it cannot be read. */
async function closerMtime(dir: string): Promise<number | null> {
  try {
    return (await fsp.stat(path.join(dir, CLOSER_FILE))).mtimeMs;
  } catch {
    return null;
  }
}
