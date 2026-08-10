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
