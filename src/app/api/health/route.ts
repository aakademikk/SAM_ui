import { execSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { getJobManager } from '@/lib/server/jobs/manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * `deploy.sh` gates the entire deploy on this endpoint, so what it does NOT
 * check is what ships broken. Until 2026-09-20 it reported uptime, a git SHA
 * and a Node version — none of which can fail while the process is running.
 * A build that left chat completely dead still returned "healthy after 2s"
 * and exited 0 (SAM_ui_Audit_2026-09-20 finding 8).
 *
 * It now probes the subsystems that actually break, and reports a status of
 * `ok` | `degraded` | `fail`:
 *
 *   jobs    the job manager can list its store — the single most load-bearing
 *           server component, behind chat, terminal, fleet and operations
 *   disk    free space where jobs, models and state are written
 *   memory  RSS against the cgroup ceiling, because this process has a known
 *           leak and an unbounded one already pushed the box into OOM once
 *   voice   the voice-line websocket host is accepting connections
 *
 * Every probe is bounded and failure-tolerant: health must never hang, and a
 * broken probe must report itself rather than 500 the endpoint. `fail` is
 * reserved for conditions that mean the server genuinely cannot serve —
 * anything survivable is `degraded`, so a flaky voice host cannot block a
 * deploy that fixed something else.
 */

const GIT_SHA = readGitSha();
const PROCESS_STARTED_AT = new Date(
  Date.now() - process.uptime() * 1000,
).toISOString();

/** Below this much free disk, jobs and uploads start failing. */
const DISK_WARN_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const DISK_FAIL_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

/** Fraction of the memory ceiling at which we start calling it degraded. */
const MEM_WARN_FRACTION = 0.85;

function readGitSha(): string | null {
  try {
    // Run from the project root so git can find .git even when the cwd is elsewhere.
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 2000,
    });
    return sha.trim() || null;
  } catch {
    return null;
  }
}

export type CheckStatus = 'ok' | 'degraded' | 'fail';

export interface HealthCheck {
  status: CheckStatus;
  detail: string;
}

export interface HealthPayload {
  status: CheckStatus;
  uptime: {
    system: number; // seconds since boot
    process: number; // seconds since this server started
  };
  startedAt: string; // ISO-8601
  gitSHA: string | null;
  nodeVersion: string;
  checks: Record<string, HealthCheck>;
}

/**
 * This process's own cgroup directory. `/sys/fs/cgroup` itself is the root of
 * the tree, which has no `memory.high`/`memory.max`, so reading there reported
 * "no ceiling" even with the unit's MemoryHigh/MemoryMax in force.
 */
async function ownCgroupDir(): Promise<string> {
  try {
    const line = (await fsp.readFile('/proc/self/cgroup', 'utf-8'))
      .split('\n')
      .find((l) => l.startsWith('0::'));
    if (line) return path.join('/sys/fs/cgroup', line.slice(3).trim());
  } catch {
    /* not on cgroup v2 — fall through to the root */
  }
  return '/sys/fs/cgroup';
}

/** Read one cgroup v2 memory file. Null when not under a cgroup or unreadable. */
async function cgroupValue(file: string): Promise<number | null> {
  try {
    const raw = (await fsp.readFile(path.join(await ownCgroupDir(), file), 'utf-8')).trim();
    if (raw === 'max') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function checkJobs(): Promise<HealthCheck> {
  try {
    const jobs = await getJobManager().list();
    const running = jobs.filter((j) => j.status === 'running').length;
    return {
      status: 'ok',
      detail: `${jobs.length} recent, ${running} running`,
    };
  } catch (err) {
    // The job manager is behind chat, terminal, fleet and operations. If it
    // cannot list, the app is not serving its purpose whatever else works.
    return {
      status: 'fail',
      detail: `job store unreadable: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    };
  }
}

async function checkDisk(): Promise<HealthCheck> {
  try {
    const stat = await fsp.statfs(path.join(os.homedir(), '.sam'));
    const freeBytes = stat.bavail * stat.bsize;
    const freeGb = (freeBytes / 1024 ** 3).toFixed(1);
    if (freeBytes < DISK_FAIL_BYTES) {
      return { status: 'fail', detail: `${freeGb} GB free` };
    }
    if (freeBytes < DISK_WARN_BYTES) {
      return { status: 'degraded', detail: `${freeGb} GB free` };
    }
    return { status: 'ok', detail: `${freeGb} GB free` };
  } catch {
    return { status: 'degraded', detail: 'could not stat ~/.sam' };
  }
}

async function checkMemory(): Promise<HealthCheck> {
  const rssMb = Math.round(process.memoryUsage.rss() / 1024 / 1024);
  const current = await cgroupValue('memory.current');
  const high = await cgroupValue('memory.high');
  const max = await cgroupValue('memory.max');
  const ceiling = high ?? max;

  if (!ceiling || !current) {
    // No cgroup ceiling at all is itself the finding — that is the state that
    // let this process contribute to a system-wide OOM on 2026-08-22.
    return { status: 'degraded', detail: `rss ${rssMb} MB, no cgroup ceiling set` };
  }

  const usedMb = Math.round(current / 1024 / 1024);
  const ceilMb = Math.round(ceiling / 1024 / 1024);
  const fraction = current / ceiling;
  const detail = `${usedMb} MB of ${ceilMb} MB (${Math.round(fraction * 100)}%)`;

  if (fraction >= 1) return { status: 'fail', detail };
  if (fraction >= MEM_WARN_FRACTION) return { status: 'degraded', detail };
  return { status: 'ok', detail };
}

async function checkVoice(): Promise<HealthCheck> {
  // Same origin the TTS route actually calls (api/chat/tts), so this probes the
  // real dependency rather than a health port that may not exist. A TCP-level
  // connect is the signal; the 405 a GET gets from a POST-only route still
  // proves the service is up and answering.
  const url = process.env.SAM_VOICE_LINE_URL ?? 'http://127.0.0.1:8790/api/tts';
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    // Voice is a nicety, not a reason to fail a deploy — chat works without it,
    // and TTS already falls back to local Kokoro when voice-line is down.
    return res.status < 500
      ? { status: 'ok', detail: `voice-line answering (HTTP ${res.status})` }
      : { status: 'degraded', detail: `voice-line HTTP ${res.status}` };
  } catch {
    return {
      status: 'degraded',
      detail: 'voice-line unreachable (TTS falls back to Kokoro)',
    };
  }
}

/** Worst status wins: any fail is a fail, else any degraded is degraded. */
function rollup(checks: Record<string, HealthCheck>): CheckStatus {
  const values = Object.values(checks).map((c) => c.status);
  if (values.includes('fail')) return 'fail';
  if (values.includes('degraded')) return 'degraded';
  return 'ok';
}

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();

  // Run in parallel: health is polled once a second by deploy.sh and must stay
  // cheap. Every probe is individually bounded, so the whole set is too.
  const [jobs, disk, memory, voice] = await Promise.all([
    checkJobs(),
    checkDisk(),
    checkMemory(),
    checkVoice(),
  ]);

  const checks = { jobs, disk, memory, voice };

  const payload: HealthPayload = {
    status: rollup(checks),
    uptime: {
      system: os.uptime(),
      process: process.uptime(),
    },
    startedAt: PROCESS_STARTED_AT,
    gitSHA: GIT_SHA,
    nodeVersion: process.version,
    checks,
  };

  return envelope(payload, 'sam.health', startedAt, estate.tick);
}
