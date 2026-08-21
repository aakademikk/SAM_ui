/**
 * SAM — CLI resume-session lock.
 *
 * A Claude Code conversation is a single session file on disk. Two concurrent
 * `claude -p … --resume <id>` processes pointed at the same file both read and
 * write it, so the chat agent route holds a per-session lock for the duration
 * of each turn:
 *
 *   - the turn's job holds the lock and renews it on a heartbeat, and
 *   - a second resume attempt while it is held is rejected with the name of
 *     the device holding it, and
 *   - a lock whose heartbeat has lapsed (the job died without closing cleanly)
 *     is stale and can be taken again.
 *
 * Locks are in-memory only, cached on globalThis so all route handlers observe
 * the same set across Next.js dev-mode module reloads. A server restart
 * orphans running jobs in exactly the same way it orphans these locks, so
 * persisting them would buy nothing.
 */

import { getJobManager } from '@/lib/server/jobs/manager';

/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const LOCK_TTL_MS = 90_000;  // a held lock goes stale 90s after its last heartbeat
const HEARTBEAT_MS = 30_000; // how often the holding job renews its lock

/* ========================================================================== */
/* Lock state                                                                  */
/* ========================================================================== */

interface SessionLock {
  sessionId: string;
  /** Human-readable name of the holding device, from the step-up payload. */
  device: string;
  /** Job backing the turn; null only in the brief window between acquire and spawn. */
  jobId: string | null;
  /** Epoch ms after which the lock is stale and takeable. */
  expiresAt: number;
  timer: NodeJS.Timeout | null;
}

const globalForSam = globalThis as unknown as { __samSessionLocks?: Map<string, SessionLock> };
const locks =
  globalForSam.__samSessionLocks ?? (globalForSam.__samSessionLocks = new Map());

/* ========================================================================== */
/* Acquire / release                                                          */
/* ========================================================================== */

export type AcquireResult =
  | { ok: true }
  | { ok: false; device: string };

/**
 * Try to take the lock on a resume session. Succeeds when the session is
 * unlocked or its previous lock has gone stale; fails with the holding device's
 * name while a live lock is held. Synchronous on purpose — the check-and-set
 * must not yield between read and write, or two simultaneous turns could both
 * pass it.
 */
export function acquireSessionLock(
  sessionId: string,
  device: string,
): AcquireResult {
  const existing = locks.get(sessionId);
  if (existing && existing.expiresAt > Date.now()) {
    return { ok: false, device: existing.device };
  }

  // Absent or stale — take it. A stale lock's heartbeat (if any) is cleared so
  // it cannot outlive the session it was guarding.
  if (existing?.timer) clearInterval(existing.timer);
  locks.set(sessionId, {
    sessionId,
    device,
    jobId: null,
    expiresAt: Date.now() + LOCK_TTL_MS,
    timer: null,
  });
  return { ok: true };
}

/**
 * Attach the spawned job to a held lock and start its heartbeat.
 *
 * The heartbeat renews the lock only while the backing job is alive. A job
 * that dies without firing close (SIGKILL, wedged server) stops renewing and
 * the lock lapses into staleness instead of wedging the session forever.
 */
export function holdSessionLock(sessionId: string, jobId: string): void {
  const lock = locks.get(sessionId);
  // Released between acquire and spawn (a command that exits instantly fires
  // its onExit release before this runs) — nothing left to hold.
  if (!lock) return;

  lock.jobId = jobId;
  lock.expiresAt = Date.now() + LOCK_TTL_MS;
  lock.timer = setInterval(() => {
    void (async () => {
      const current = locks.get(sessionId);
      // Only act on the turn this heartbeat belongs to — a session that was
      // released and re-acquired must not be released by the previous turn's
      // stale heartbeat.
      if (!current || current.jobId !== jobId) return;

      const record = await getJobManager().get(jobId);
      if (record?.status === 'running') {
        current.expiresAt = Date.now() + LOCK_TTL_MS;
      } else {
        releaseSessionLock(sessionId);
      }
    })();
  }, HEARTBEAT_MS);
}

/** Drop the lock on a resume session. Idempotent — safe to call twice. */
export function releaseSessionLock(sessionId: string): void {
  const lock = locks.get(sessionId);
  if (lock?.timer) clearInterval(lock.timer);
  locks.delete(sessionId);
}
