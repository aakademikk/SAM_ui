/**
 * SAM: closer record reader (completed-jobs lists, T3).
 *
 * Reads the one file the Job Closer leaves in a job directory,
 * `<job_dir>/closer.json`, and returns its verdict string when the record is
 * valid. This depends only on that file, never on the closer's code, so the
 * lists work unchanged on a machine where the closer is not installed.
 *
 * It never throws, never reads more than MAX_READ_BYTES, and never waits on
 * anything but the one open, stat and read. Every failure (absent, unreadable,
 * too large, empty, bad JSON, wrong shape) is "no record" and returns null.
 * Only the verdict string is read into a row; no other closer field is used.
 *
 * Spec: must-dos 14, 15, 16; check 5.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

/** The closer's record, one per job directory. */
export const CLOSER_FILE = 'closer.json';

/**
 * Most bytes read from any one file by the finished-jobs reads (must-do 13).
 * Shared with the store scan's `meta.json` reads.
 */
export const MAX_READ_BYTES = 16384;

// A verdict counts only when its start, after trimming, is one of these
// (upper case), as the closer writes `PASS (n/m checks)`, `FAIL: <reason>` or
// `UNKNOWN: <reason>`.
const VERDICT_STARTS: readonly string[] = ['PASS', 'FAIL', 'UNKNOWN'];

export interface CloserVerdict {
  verdict: string;
  /** The record's mtime, so a caller can notice a changed record and re-read it. */
  mtimeMs: number;
}

/** The verdict from a parsed record, or null unless it is a valid closed record. */
function verdictOf(record: unknown): string | null {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
  const { status, verdict } = record as Record<string, unknown>;
  if (status !== 'closed' || typeof verdict !== 'string') return null;
  const trimmed = verdict.trim();
  return VERDICT_STARTS.some((start) => trimmed.startsWith(start)) ? trimmed : null;
}

/** The closer's verdict for one job directory, or null for "no record". Never throws. */
export async function readCloserVerdict(jobDir: string): Promise<CloserVerdict | null> {
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(path.join(jobDir, CLOSER_FILE), 'r');
    const st = await handle.stat();
    // A file larger than the cap is "no record" rather than read in part: a
    // truncated read would be invalid JSON anyway.
    if (!st.isFile() || st.size === 0 || st.size > MAX_READ_BYTES) return null;

    const buf = Buffer.alloc(Math.min(st.size, MAX_READ_BYTES));
    let filled = 0;
    while (filled < buf.length) {
      const { bytesRead } = await handle.read(buf, filled, buf.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }

    const verdict = verdictOf(JSON.parse(buf.subarray(0, filled).toString('utf-8')));
    return verdict === null ? null : { verdict, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
