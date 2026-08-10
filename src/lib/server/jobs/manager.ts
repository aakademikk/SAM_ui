/**
 * SAM — Job manager singleton.
 *
 * Owns the lifecycle of every server-side job: creation, execution, output
 * persistence, and cleanup. Cached on globalThis so all API route handlers
 * observe the same job set across Next.js dev-mode module reloads.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { JobRecord, JobSummary } from '@/types/jobs';

/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB per job
const MAX_JOBS = 128;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function jobDir(id: string): string {
  return path.join(JOBS_ROOT, id);
}

function metaPath(id: string): string {
  return path.join(jobDir(id), 'meta.json');
}

function stdoutPath(id: string): string {
  return path.join(jobDir(id), 'stdout.log');
}

let idCounter = 0;

function nextId(): string {
  idCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 46656).toString(36);
  const seq = idCounter.toString(36);
  return `job_${ts}_${rand}_${seq}`;
}

async function ensureRoot() {
  await fsp.mkdir(JOBS_ROOT, { recursive: true });
}

/* ========================================================================== */
/* Output writer — append-only, sequence-numbered                             */
/* ========================================================================== */

/**
 * Binary frame format (no text delimiters — data can contain anything):
 *   4 bytes: sequence number (uint32 BE)
 *   4 bytes: data length (uint32 BE)
 *   N bytes: data
 *
 * Total frame overhead: 8 bytes. The parser is O(n) and never confused by
 * output that happens to look like a header.
 */
const FRAME_HEADER_BYTES = 8;

class OutputWriter {
  private bytes = 0;
  seq = 0;
  private filePath: string;

  constructor(jobId: string) {
    this.filePath = stdoutPath(jobId);
  }

  async init() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, '');
  }

  async write(chunk: Buffer | string): Promise<number> {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf-8');
    if (data.length === 0) return this.seq;

    if (this.bytes + data.length > MAX_OUTPUT_BYTES) {
      this.bytes = 0;
      await fsp.writeFile(this.filePath, '');
    }

    this.seq++;

    // Build binary frame: [4-byte seq BE][4-byte len BE][data]
    const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + data.length);
    frame.writeUInt32BE(this.seq, 0);
    frame.writeUInt32BE(data.length, 4);
    data.copy(frame, FRAME_HEADER_BYTES);

    await fsp.appendFile(this.filePath, frame);

    this.bytes += frame.length;
    return this.seq;
  }

  async close() {
    // No persistent fd — nothing to flush.
  }
}

/* ========================================================================== */
/* Output reader — for SSE replay                                              */
/* ========================================================================== */

export interface OutputFrame {
  seq: number;
  data: Buffer;
}

/** Parse binary-framed stdout.log. Returns frames with seq > fromSeq. */
export async function readFrames(
  jobId: string,
  fromSeq: number = 0,
): Promise<OutputFrame[]> {
  const filePath = stdoutPath(jobId);
  let raw: Buffer;

  try {
    raw = await fsp.readFile(filePath);
  } catch {
    return [];
  }

  const frames: OutputFrame[] = [];
  let pos = 0;

  while (pos + FRAME_HEADER_BYTES <= raw.length) {
    const seq = raw.readUInt32BE(pos);
    const len = raw.readUInt32BE(pos + 4);
    pos += FRAME_HEADER_BYTES;

    if (len < 0 || pos + len > raw.length) break; // truncated write

    const data = raw.subarray(pos, pos + len);
    pos += len;

    if (seq > fromSeq) {
      frames.push({ seq, data });
    }
  }

  return frames;
}

/* ========================================================================== */
/* Job handle                                                                 */
/* ========================================================================== */

interface RunningJob {
  record: JobRecord;
  process: ChildProcess;
  output: OutputWriter;
}

/* ========================================================================== */
/* Manager                                                                    */
/* ========================================================================== */

class JobManager {
  private jobs = new Map<string, RunningJob>();
  private completedIds: string[] = [];

  async ensure() {
    await ensureRoot();
  }

  /** Create and start a new job. */
  async create(command: string): Promise<JobRecord> {
    await this.ensure();

    const id = nextId();
    const now = new Date().toISOString();
    const output = new OutputWriter(id);
    await output.init();

    const record: JobRecord = {
      id,
      command,
      status: 'queued',
      exitCode: null,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      outputBytes: 0,
      lastSeq: 0,
    };

    const child = spawn(command, [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: os.homedir(),
      env: { ...process.env },
    });

    record.status = 'running';
    record.startedAt = new Date().toISOString();

    // Register handlers BEFORE any await — fast-exiting commands (bare echo,
    // etc.) can finish during the first I/O and we must not miss the close
    // or data events.

    const onData = async (chunk: Buffer) => {
      const seq = await output.write(chunk);
      if (seq > 0) {
        record.lastSeq = seq;
        record.outputBytes += chunk.length;
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('close', async (code) => {
      record.status = code === null ? 'killed' : 'exited';
      record.exitCode = code;
      record.endedAt = new Date().toISOString();
      await output.close();
      await this.writeMeta(record);
      this.jobs.delete(id);
      this.completedIds.push(id);
      this.prune();
    });

    child.on('error', async (err) => {
      const chunk = Buffer.from(`\n[SAM] process error: ${err.message}\n`, 'utf-8');
      await output.write(chunk);
    });

    // Now persist the initial meta (handlers are already armed).
    await this.writeMeta(record);

    const running: RunningJob = { record, process: child, output };
    this.jobs.set(id, running);
    this.prune();

    return { ...record };
  }

  /** Get a job by ID. */
  async get(id: string): Promise<JobRecord | null> {
    const running = this.jobs.get(id);
    if (running) return { ...running.record };

    try {
      const raw = await fsp.readFile(metaPath(id), 'utf-8');
      return JSON.parse(raw) as JobRecord;
    } catch {
      return null;
    }
  }

  /** List recent jobs. */
  async list(): Promise<JobSummary[]> {
    const summaries: JobSummary[] = [];

    for (const [, running] of this.jobs) {
      summaries.push(summarise(running.record));
    }

    for (let i = this.completedIds.length - 1; i >= 0; i--) {
      const id = this.completedIds[i];
      try {
        const raw = await fsp.readFile(metaPath(id), 'utf-8');
        summaries.push(summarise(JSON.parse(raw) as JobRecord));
      } catch {
        // pruned
      }
    }

    return summaries.slice(0, 64);
  }

  /** Kill a running job. */
  async kill(id: string): Promise<boolean> {
    const running = this.jobs.get(id);
    if (!running) return false;

    running.process.kill('SIGTERM');
    setTimeout(() => {
      if (running.process.exitCode === null) {
        running.process.kill('SIGKILL');
      }
    }, 3000);

    return true;
  }

  /** Write to a job's stdin. */
  async writeStdin(id: string, input: string): Promise<boolean> {
    const running = this.jobs.get(id);
    if (!running || running.record.status !== 'running') return false;

    running.process.stdin?.write(input);
    return true;
  }

  /** Get output frames from a sequence number. */
  async getOutput(id: string, fromSeq: number = 0): Promise<OutputFrame[]> {
    return readFrames(id, fromSeq);
  }

  private async writeMeta(record: JobRecord) {
    await fsp.mkdir(jobDir(record.id), { recursive: true });
    await fsp.writeFile(metaPath(record.id), JSON.stringify(record, null, 2));
  }

  private prune() {
    if (this.completedIds.length > MAX_JOBS) {
      const toDelete = this.completedIds.splice(0, this.completedIds.length - MAX_JOBS);
      for (const id of toDelete) {
        fsp.rm(jobDir(id), { recursive: true, force: true }).catch(() => {});
      }
    }

    const cutoff = Date.now() - RETENTION_MS;
    this.completedIds = this.completedIds.filter((id) => {
      const tsPart = id.split('_')[1];
      if (!tsPart) return true;
      try {
        const ts = parseInt(tsPart, 36);
        if (ts < cutoff) {
          fsp.rm(jobDir(id), { recursive: true, force: true }).catch(() => {});
          return false;
        }
      } catch {
        // keep
      }
      return true;
    });
  }
}

function summarise(r: JobRecord): JobSummary {
  return {
    id: r.id,
    command: r.command,
    status: r.status,
    exitCode: r.exitCode,
    createdAt: r.createdAt,
    endedAt: r.endedAt,
  };
}

/* ========================================================================== */
/* Singleton                                                                  */
/* ========================================================================== */

const globalForSam = globalThis as unknown as { __samJobManager?: JobManager };

export function getJobManager(): JobManager {
  if (!globalForSam.__samJobManager) {
    globalForSam.__samJobManager = new JobManager();
  }
  return globalForSam.__samJobManager;
}

export { JobManager };
