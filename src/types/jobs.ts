/**
 * SAM — Job system types.
 *
 * Every command the operator runs becomes a server-side job that survives
 * browser disconnection. Output streams over SSE with monotonic sequence
 * numbers so a reconnecting client resumes from Last-Event-ID.
 */

export type JobStatus = 'queued' | 'running' | 'exited' | 'killed';

export interface JobRecord {
  id: string;
  command: string;
  status: JobStatus;
  exitCode: number | null;
  createdAt: string;   // ISO-8601
  startedAt: string | null;
  endedAt: string | null;
  /** Total bytes written to stdout (including stderr, which is merged). */
  outputBytes: number;
  /** Last sequence number written. Clients reconnect from this. */
  lastSeq: number;
  /** PID of the spawned process (systemd-run scope leader). Absent on pre-fix jobs. */
  pid?: number;
  /** /proc start-time ticks at spawn — guards against PID reuse across restarts. */
  procStart?: number;
  /**
   * Terminating signal (e.g. 'SIGTERM'), when the process was killed rather
   * than exiting on its own. Node reports `code: null` in that case, so without
   * this a restart-kill, an OOM kill and a user cancel were indistinguishable.
   */
  signal?: string | null;
  /**
   * How `exitCode` was obtained:
   *   'parent'   — reaped live by the spawning server (authoritative)
   *   'sentinel' — recovered from the scope's own exit-code file after the
   *                server restarted mid-job (authoritative)
   *   'unknown'  — the job vanished with no sentinel; the outcome is genuinely lost
   */
  exitSource?: 'parent' | 'sentinel' | 'unknown';
}

/** Returned by GET /api/jobs — summary only, no output. */
export interface JobSummary {
  id: string;
  command: string;
  status: JobStatus;
  exitCode: number | null;
  createdAt: string;
  endedAt: string | null;
}
