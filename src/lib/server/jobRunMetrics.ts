/**
 * SAM — real automation run telemetry.
 *
 * Reads the retained job store under ~/.sam/jobs (the same store the Fleet
 * tab's Recent Runs and spend scan read) and counts runs in the last 24
 * hours. A run counts as failed only when it errored on its own — a kill or
 * SIGTERM is a termination, not a crash. This replaces the random-increment
 * simulator counters.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 8_000;

export interface RunStats {
  runs24h: number;
  failures24h: number;
}

interface StoredMeta {
  status?: string;
  exitCode?: number | null;
  createdAt?: string;
}

/**
 * A run counts as a *failure* only when it errored out on its own. Terminations
 * are not failures: status 'killed' and exit 143 (SIGTERM) cover a user stop,
 * the chat watchdog, or a server restart — all deliberate or environmental, not
 * crashes. A null exit code means killed-by-signal or unrecorded; also not a
 * failure.
 */
function isFailure(meta: StoredMeta): boolean {
  if (meta.status === 'failed' || meta.status === 'error') return true;
  if (meta.exitCode === 143) return false;
  if (typeof meta.exitCode === 'number' && meta.exitCode !== 0) return true;
  return false;
}

function scanNow(): RunStats {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(JOBS_ROOT);
  } catch {
    return { runs24h: 0, failures24h: 0 };
  }

  const since = Date.now() - WINDOW_MS;
  let runs = 0;
  let failures = 0;

  for (const dir of dirs) {
    if (!dir.startsWith('job_')) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(JOBS_ROOT, dir, 'meta.json'), 'utf-8');
    } catch {
      continue;
    }

    let meta: StoredMeta;
    try {
      meta = JSON.parse(raw) as StoredMeta;
    } catch {
      continue;
    }
    if (!meta.createdAt) continue;

    const created = Date.parse(meta.createdAt);
    if (Number.isNaN(created) || created < since) continue;

    runs++;
    if (isFailure(meta)) failures++;
  }

  return { runs24h: runs, failures24h: failures };
}

let cached: { at: number; stats: RunStats } | null = null;

/** Real 24h run/failure counts from the job store. Cached like vaultMetrics. */
export function readRunStats(): RunStats {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.stats;
  const stats = scanNow();
  cached = { at: Date.now(), stats };
  return stats;
}
