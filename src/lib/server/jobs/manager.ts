/**
 * SAM — Job manager singleton.
 *
 * Owns the lifecycle of every server-side job: creation, execution, output
 * persistence, and cleanup. Cached on globalThis so all API route handlers
 * observe the same job set across Next.js dev-mode module reloads.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import type { JobRecord, JobSummary } from '@/types/jobs';

/* ========================================================================== */
/* Configuration                                                              */
/* ========================================================================== */

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB per job
/**
 * Where a trim takes the retained output down to, as a fraction of the cap.
 * Trimming to exactly the cap would re-read and rewrite the whole file on the
 * very next chunk; dropping to 75% makes that happen once per ~250 KB instead.
 */
const TRIM_TO_FRACTION = 0.75;
const MAX_JOBS = 128;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Ids whose timestamp segment decodes earlier than this are not ours to date. */
const MIN_PLAUSIBLE_TS = Date.UTC(2024, 0, 1);
/** How often the on-disk retention sweep runs after the one at boot. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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

/**
 * Where the scope writes its own exit code.
 *
 * The spawning server reaps the exit code through the child handle, but that
 * handle belongs to the `systemd-run` *client*. Restart sam-ui mid-job and the
 * client dies while the scope keeps running in its sibling cgroup — the close
 * handler never fires, and the job used to be finalised with a null code even
 * when it had completed perfectly. Measured over 7 days that mis-filed ~17 real
 * outcomes as unknown, which is what surfaced on mobile as "The agent exited".
 *
 * So the scope records its own result: whoever reads it later gets the truth.
 * A missing file means the scope was torn down before it could write, i.e. the
 * job genuinely died — which is exactly the state we do want reported.
 */
function exitCodePath(id: string): string {
  return path.join(jobDir(id), 'exitcode');
}

/**
 * Read the exit code a finished scope left behind. Returns null when there is
 * no sentinel (job genuinely died) or it is unreadable/malformed.
 */
async function readExitSentinel(id: string): Promise<number | null> {
  try {
    const raw = (await fsp.readFile(exitCodePath(id), 'utf-8')).trim();
    if (!raw) return null;
    const code = Number(raw);
    return Number.isInteger(code) ? code : null;
  } catch {
    return null;
  }
}

/* ========================================================================== */
/* Headless (sam-job) unit liveness                                           */
/* ========================================================================== */

/**
 * `sam-job` / `sam-dispatch` jobs run in a transient systemd user unit and
 * write meta.json with a `unit` but no `pid`/`procStart`, so the pid check
 * cannot see them. Their unit is the liveness handle instead.
 */
export type UnitState = 'active' | 'inactive' | 'unknown';

/** Shape of a unit name we are willing to hand to systemctl. */
const UNIT_NAME_RE = /^[A-Za-z0-9@._:-]+$/;

export function isSafeUnitName(unit: unknown): unit is string {
  if (typeof unit !== 'string' || !UNIT_NAME_RE.test(unit)) return false;
  // A leading dash would be read as an option; a suffix other than the two we
  // emit (or none at all) is not a unit of ours.
  if (unit.startsWith('-')) return false;
  const dot = unit.lastIndexOf('.');
  return dot === -1 || unit.endsWith('.service') || unit.endsWith('.scope');
}

function queryUnitState(unit: string): Promise<UnitState> {
  return new Promise((resolve) => {
    execFile(
      'systemctl',
      ['--user', 'show', '-p', 'ActiveState', '--value', unit],
      { timeout: 5_000 },
      (err, stdout) => {
        if (err) return resolve('unknown');
        const state = String(stdout).trim();
        if (state === 'inactive' || state === 'failed') return resolve('inactive');
        if (['active', 'activating', 'deactivating', 'reloading'].includes(state)) return resolve('active');
        resolve('unknown');
      },
    );
  });
}

let unitStateFn: (unit: string) => Promise<UnitState> = queryUnitState;
let unitPollMs = 5_000;

/** Test-only: replace the systemd lookup and shorten the poll interval. */
export function __setUnitProbeForTests(
  fn: ((unit: string) => Promise<UnitState>) | null,
  pollMs = 5_000,
): void {
  unitStateFn = fn ?? queryUnitState;
  unitPollMs = pollMs;
}

/** Asks for a unit's state; a name that fails validation is never executed. */
async function unitState(unit: unknown): Promise<UnitState> {
  if (!isSafeUnitName(unit)) return 'unknown';
  try {
    return await unitStateFn(unit);
  } catch {
    return 'unknown';
  }
}

/**
 * Wrap a payload so the scope reports its own cgroup and exit code.
 *
 * `bash -c '<fixed script>' _ <bin> <args...>` puts the payload in `"$@"`, so
 * argument content is never interpolated into the script text — the shell:false
 * injection guarantee of createArgs() is preserved. Both destinations come
 * through the environment for the same reason.
 */
function withExitSentinel(argv: string[]): string[] {
  return [
    'bash',
    '-c',
    // The cgroup is recorded first, while this wrapper is still the scope
    // leader: it is the only handle that reaches every process the job owns,
    // and the only way to unload the scope afterwards.
    'cat /proc/self/cgroup > "$SAM_CGROUP_FILE" 2>/dev/null; "$@"; printf %s "$?" > "$SAM_EXIT_FILE"',
    '_',
    ...argv,
  ];
}

function cgroupFilePath(id: string): string {
  return path.join(jobDir(id), 'cgroup');
}

/**
 * The transient scope this job runs in, read back from the cgroup the wrapper
 * recorded at start. Null when the job never started, or predates the record.
 */
async function readScopeUnit(id: string): Promise<string | null> {
  try {
    const raw = (await fsp.readFile(cgroupFilePath(id), 'utf-8')).trim();
    // "0::/user.slice/…/run-p123-i456.scope" → "run-p123-i456.scope"
    const rel = raw.split(':').slice(2).join(':');
    const unit = rel.split('/').filter(Boolean).pop();
    return unit && unit.endsWith('.scope') ? unit : null;
  } catch {
    return null;
  }
}

/**
 * Send a signal to every process in the job's scope.
 *
 * The cgroup — not the process group — is the correct handle. Measured from
 * the server 2026-09-10: the scope leader's process group is the *sam-ui
 * service's* group, not its own. `spawn` gives the child no job control, so it
 * inherits the server's pgid; systemd-run --scope moves it into a new cgroup
 * but does not call setsid. A group signal aimed at `record.pid` therefore
 * throws ESRCH and quietly degrades to signalling the leader alone — which is
 * the original orphan bug — and had the inherited pgid ever matched
 * `record.pid`, the signal would have landed on the server's own group
 * instead. The cgroup is the job's alone and cannot reach anything else.
 *
 * The unit name is validated against the shape systemd generates for a
 * transient user scope before it goes anywhere near systemctl: the file it is
 * read from lives in the job's own directory, and the payload inherits the
 * path, so an untrusted payload must not be able to name a unit of its
 * choosing (e.g. sam-ui.service) and have us stop it.
 */
function scopeSignal(unit: string, signal: NodeJS.Signals) {
  if (!/^run-p\d+-i\d+\.scope$/.test(unit)) return;
  try {
    spawn('systemctl', ['--user', 'kill', `--signal=${signal}`, unit], {
      shell: false,
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch {
    // Best effort — a missing systemctl must not turn a stop into a 500.
  }
}

/**
 * SIGKILL whatever is left in the scope, then unload the unit.
 *
 * Both halves are needed: the kill reaches a payload that ignored the earlier
 * SIGTERM or escaped into its own session, and the stop is what removes the
 * unit. systemd does not collect an emptied scope on its own — a scope that
 * ends *by itself* is collected, but one emptied by a kill stays `active
 * running` with zero processes, which is how 22 of them accumulated by
 * 2026-09-10. Sequenced in one shell so the stop cannot run before the kill.
 */
function teardownScope(unit: string) {
  if (!/^run-p\d+-i\d+\.scope$/.test(unit)) return;
  try {
    spawn(
      'bash',
      [
        '-c',
        'systemctl --user kill --signal=SIGKILL "$1" 2>/dev/null; systemctl --user stop "$1" 2>/dev/null',
        '_',
        unit,
      ],
      { shell: false, stdio: 'ignore', detached: true },
    ).unref();
  } catch {
    // Best effort: the kill has already been attempted.
  }
}

/** Process start time in /proc clock ticks, or null if the PID is gone. */
function procStartTicks(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
    // Field 22 (starttime), indexed from field 3 after the parenthesised comm.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(afterComm[19]);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

/**
 * True if `pid` still exists and is the same process we spawned. The start-time
 * check rules out PID reuse — Linux can hand the same number to an unrelated
 * process after the original dies, which a bare existence check would mistake
 * for a still-running job.
 */
function processAlive(pid: number, startTicks: number | null): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    // EPERM: exists but owned by another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
  if (startTicks === null) return true;
  const now = procStartTicks(pid);
  return now === null || now === startTicks;
}

let idCounter = 0;

function nextId(): string {
  idCounter++;
  const ts = Date.now().toString(36);
  // 128-bit random instead of the old 36^3 ≈ 46k-value middle segment — job
  // IDs are now unguessable, so the stream route's auth guard is the boundary
  // rather than ID obscurity (Job 07 adjacent finding). The underscore layout
  // is unchanged so time-based retention parsing (split('_')[1]) still works.
  const rand = crypto.randomUUID().replaceAll('-', '');
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

  /**
   * The tail of the write queue. `child.stdout.on('data')` fires without
   * awaiting its handler, so several write() calls are in flight at once, and
   * each one used to check `this.bytes` and decide for itself whether the cap
   * had been breached. Three concurrent trims then meant three `writeFile`
   * calls racing on one path — `writeFile` truncates and writes from its own
   * file offset, so the loser landed part-way down and left a 512 KB hole
   * where the transcript should have started (measured: a 1055746-byte file
   * whose first non-zero byte was at 524288, from which `readFrames` parsed
   * nothing at all). Serialising makes the byte count honest and every fs
   * operation sequential.
   */
  private tail: Promise<unknown> = Promise.resolve();

  async write(chunk: Buffer | string): Promise<number> {
    const run = this.tail.then(
      () => this.writeNow(chunk),
      () => this.writeNow(chunk),
    );
    // The chain must survive a failed write, or one bad append would stall
    // every frame behind it. The caller still sees the rejection.
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async writeNow(chunk: Buffer | string): Promise<number> {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf-8');
    if (data.length === 0) return this.seq;

    if (this.bytes + FRAME_HEADER_BYTES + data.length > MAX_OUTPUT_BYTES) {
      await this.trim();
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

  /**
   * Drop the OLDEST whole frames until the file is back under the low-water
   * mark, keeping the most recent output rather than discarding all of it.
   *
   * The original code wiped stdout.log to empty here and reset the byte count,
   * while `seq` carried on climbing. A client that reconnected and asked for
   * everything after its last sequence number therefore received a transcript
   * starting part-way through, with nothing to say so — job `…_1k` wrote
   * 8.28 MB in one turn and the file held 142 KB of it, silently. The bounded
   * window is fine; lying about it is not, which is why the stream route now
   * reports the gap (see the `truncated` event).
   *
   * Whole frames only: readFrames walks the buffer by the length header, so a
   * partial frame at the front would corrupt the parse of everything after it.
   */
  private async trim() {
    let raw: Buffer;
    try {
      raw = await fsp.readFile(this.filePath);
    } catch {
      // Unreadable — treat as empty and let the append recreate it.
      this.bytes = 0;
      return;
    }

    // Trim to below the cap rather than exactly to it: a full read-and-rewrite
    // once per ~250 KB beats one on every chunk once the file is at the limit.
    const target = Math.floor(MAX_OUTPUT_BYTES * TRIM_TO_FRACTION);
    let pos = 0;
    while (raw.length - pos > target && pos + FRAME_HEADER_BYTES <= raw.length) {
      const len = raw.readUInt32BE(pos + 4);
      const next = pos + FRAME_HEADER_BYTES + len;
      // Truncated tail — stop here rather than guess at an offset.
      if (next > raw.length) break;
      pos = next;
    }

    const kept = raw.subarray(pos);
    await fsp.writeFile(this.filePath, kept);
    this.bytes = kept.length;
  }

  async close() {
    // No persistent fd, but queued writes can still be draining: the 'data'
    // handlers are async and unawaited, so the process can exit with frames
    // still in the queue. Awaiting it here is what lets the caller treat the
    // file, and the sequence count in the record, as final.
    await this.tail.catch(() => undefined);
  }
}

/* ========================================================================== */
/* Output reader — for SSE replay                                              */
/* ========================================================================== */

export interface OutputFrame {
  seq: number;
  data: Buffer;
}

/**
 * sam-job's worker (run.sh) pipes a job's stdout/stderr straight into
 * stdout.log with plain shell redirection (`> stdout.log 2>&1`) — no framing
 * at all, because that script has never heard of OutputWriter. Its meta.json
 * (written by /home/col/.local/bin/sam-job) is what tells the two formats
 * apart: it always has a `unit` (the systemd transient-unit name) and never a
 * `lastSeq` (a field only JobManager's own records carry), where a
 * JobManager-created record is the reverse. Detection reads that fingerprint
 * off disk rather than trying to sniff the bytes.
 */
function isSamJobShape(raw: Record<string, unknown>): boolean {
  return typeof raw.unit === 'string' && raw.lastSeq === undefined;
}

async function isSamJobRecord(jobId: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await fsp.readFile(metaPath(jobId), 'utf-8')) as Record<
      string,
      unknown
    >;
    return isSamJobShape(raw);
  } catch {
    return false;
  }
}

/**
 * Same fingerprint as `isSamJobRecord`, for a `JobRecord` already in hand
 * (the stream route's own `manager.get(id)` result) rather than reading
 * meta.json a second time. Exported for the stream route's orphan check
 * (review finding 11): a sam-job job is never tracked in this process's own
 * `this.jobs` map — sam-job spawns it through its own `systemd-run`, not
 * through `JobManager.create`/`createArgs` — so `isLive(id)` is always false
 * for one, which must not be read as "the process died" the way it is for a
 * JobManager-spawned job.
 */
export function isSamJobJobRecord(record: JobRecord): boolean {
  return isSamJobShape(record as unknown as Record<string, unknown>);
}

/** Chunk size for a plain-text (sam-job) log. Arbitrary but bounded, so a huge log still streams in pieces rather than one giant SSE frame. */
const SAM_JOB_CHUNK_BYTES = 64 * 1024;

/**
 * If `end` lands inside a multi-byte UTF-8 sequence, back it off to the start
 * of that sequence instead.
 *
 * Each chunk is later decoded independently — formatFrame() and scanFrame()
 * in the stream route both call `.toString('utf-8')` per frame, not on the
 * whole file — so a split mid-character would turn one real character into a
 * `�` in one chunk and stray continuation bytes in the next. Walking
 * back over up to 3 trailing continuation bytes (0b10xxxxxx) to find the lead
 * byte, then checking whether that lead byte's declared sequence length fits
 * before `end`, catches every case: an ASCII boundary (no continuation byte
 * right before `end`) is returned unchanged.
 */
function safeUtf8Boundary(raw: Buffer, start: number, end: number): number {
  if (end >= raw.length) return end;

  let cut = end;
  let back = 0;
  while (back < 3 && cut > start && (raw[cut - 1] & 0xc0) === 0x80) {
    cut--;
    back++;
  }
  if (cut === end) return end; // byte right before `end` isn't a continuation byte — clean cut

  const lead = raw[cut];
  let seqLen: number;
  if ((lead & 0xe0) === 0xc0) seqLen = 2;
  else if ((lead & 0xf0) === 0xe0) seqLen = 3;
  else if ((lead & 0xf8) === 0xf0) seqLen = 4;
  else return end; // not a recognised lead byte (invalid UTF-8 already) — leave it

  // Sequence starting at `cut` doesn't fully fit before `end`: move the whole
  // character into the next chunk. If `cut` had to fall back to `start`
  // itself there is nowhere left to retreat to, so just take the byte as-is
  // rather than emit an empty chunk.
  return cut + seqLen > end && cut > start ? cut : end;
}

/** Split a plain-text log into <=64KB chunks, numbered seq 1..n. */
function chunkPlainText(raw: Buffer, fromSeq: number): OutputFrame[] {
  const frames: OutputFrame[] = [];
  let pos = 0;
  let seq = 0;

  while (pos < raw.length) {
    const end = safeUtf8Boundary(raw, pos, Math.min(pos + SAM_JOB_CHUNK_BYTES, raw.length));
    seq++;
    if (seq > fromSeq) {
      frames.push({ seq, data: raw.subarray(pos, end) });
    }
    pos = end;
  }

  return frames;
}

/**
 * Read a job's output as a list of frames with seq > fromSeq.
 *
 * Two on-disk shapes are understood: JobManager's own binary-framed format
 * (4-byte seq, 4-byte length, data — see OutputWriter above), and sam-job's
 * plain-text log, chunked into frames here rather than at write time since
 * run.sh writes it directly with shell redirection. See isSamJobRecord().
 */
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

  if (await isSamJobRecord(jobId)) {
    return chunkPlainText(raw, fromSeq);
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

/** Where the job's stdout stands relative to line boundaries, so a marker
 *  appended to the output log never lands inside a line a chunk split. */
interface StdoutLineState {
  /** True when the last stdout chunk did not end with a newline. */
  midLine: boolean;
  /** Marker lines waiting for the next stdout chunk that ends a line. */
  deferred: string[];
}

interface RunningJob {
  record: JobRecord;
  process: ChildProcess;
  output: OutputWriter;
  lineState: StdoutLineState;
}

export interface CreateArgsOptions {
  /** Human-readable string stored as the job's `command`. Never executed. */
  label?: string;
  cwd?: string;
  /**
   * Environment overlaid on `process.env`. A `null` value *removes* the
   * variable — needed to stop an inherited key (e.g. `ANTHROPIC_BASE_URL`
   * from `.env.local`) silently redirecting a child to the wrong provider.
   */
  env?: Record<string, string | null>;
  /**
   * Fired once the process has closed and its meta is written. Runs
   * detached — a throw here must never affect the job, which has already
   * finished. Used to report third-party spend to the estate cost ledger,
   * where the cost is only knowable after the run.
   */
  onExit?: (record: JobRecord) => void | Promise<void>;
  /**
   * Whether the child's stdin is piped or left `/dev/null`. Defaults to
   * `'ignore'`: see the comment on `createArgs`'s own `stdio` for why an open
   * pipe the CLI never hears from costs ~2.9s a turn. Only a caller that
   * actually intends to write to stdin (a chat turn streaming its prompt in)
   * should pass `'pipe'`.
   */
  stdin?: 'pipe' | 'ignore';
  /** Fired for every STDOUT chunk (never stderr), right after it's written to
   *  the job's own output log — a side channel for a caller that needs to
   *  react to the child's stdout live (e.g. detecting a `result` line to
   *  close stdin), without duplicating the write/bookkeeping `attach` already
   *  does. stderr is excluded so a stderr fragment can never be glued onto a
   *  stdout line in the caller's own line buffer. */
  onOutputChunk?: (chunk: Buffer, record: JobRecord) => void;
}

function mergeEnv(overrides?: Record<string, string | null>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Test-only: awaited inside `deliverSideMessage` between the stdin write and
 *  the marker write, so a test can make one delivery slow. */
let deliverHook: ((markerLine: string) => Promise<void>) | null = null;
export function __setDeliverHookForTests(hook: ((markerLine: string) => Promise<void>) | null): void {
  deliverHook = hook;
}

/* ========================================================================== */
/* Manager                                                                    */
/* ========================================================================== */

class JobManager {
  private jobs = new Map<string, RunningJob>();
  private completedIds: string[] = [];

  constructor() {
    // A fresh process can't have live children — any record left 'running' on
    // disk is a zombie from a service restart. Flip it now so a reconnect gets
    // a terminal status instead of a stream that polls a frozen record forever.
    void this.reconcileOrphans();

    // Retention, which until 2026-09-20 had never actually run against the
    // store on disk. Once at boot, then hourly — a server that stays up for
    // days must not wait for a restart to collect anything. `unref` so this
    // timer can never hold the process open at shutdown.
    void this.sweepDisk();
    this.sweepTimer = setInterval(() => void this.sweepDisk(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /** Hourly retention sweep. Held so tests and shutdown can stop it. */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Stop the background sweep. Idempotent. */
  stopSweep() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async ensure() {
    await ensureRoot();
  }

  /**
   * Scan the job store once at boot and finalise records claiming 'running'.
   * Jobs run in their own transient systemd scope, so they *outlive* a sam-ui
   * restart — only a process that is genuinely gone died with the server. A
   * surviving process is watched to its real end instead of being falsely
   * declared killed (Job 08 adjacent finding); one with no PID to check (pre-
   * fix record) falls back to 'killed' as before.
   */
  private async reconcileOrphans() {
    await ensureRoot();
    let entries;
    try {
      entries = await fsp.readdir(JOBS_ROOT, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('job_')) continue;
      const file = metaPath(entry.name);
      let record: JobRecord;
      try {
        record = JSON.parse(await fsp.readFile(file, 'utf-8')) as JobRecord;
      } catch {
        // Unreadable or malformed meta — not ours to fix.
        continue;
      }
      if (record.status !== 'running') continue;

      if (record.pid && processAlive(record.pid, record.procStart ?? null)) {
        void this.watchOrphan(record, file);
        continue;
      }

      // A headless sam-job job has a unit instead of a pid. While that unit
      // is active the job is alive: watch it, never file it as killed.
      if (!record.pid && record.unit && (await unitState(record.unit)) === 'active') {
        const watch = this.watchUnit(record, file).finally(() => this.unitWatches.delete(watch));
        this.unitWatches.add(watch);
        continue;
      }

      // Process is gone. Before declaring it killed, ask the scope what
      // actually happened — a job that completed while sam-ui was down leaves
      // its exit code behind, and used to be libelled as killed regardless.
      const sentinel = await readExitSentinel(record.id);
      if (sentinel !== null) {
        record.status = 'exited';
        record.exitCode = sentinel;
        record.exitSource = 'sentinel';
      } else {
        record.status = 'killed';
        record.exitSource = 'unknown';
      }
      record.endedAt = new Date().toISOString();
      await fsp.writeFile(file, JSON.stringify(record, null, 2));
    }
  }

  private unitWatches = new Set<Promise<void>>();

  /** Test-only: run the boot reconcile and wait for every unit watch to end. */
  async __reconcileForTests(): Promise<void> {
    await this.reconcileOrphans();
    while (this.unitWatches.size > 0) await Promise.all([...this.unitWatches]);
  }

  /**
   * Poll a headless job's unit until it is no longer active, then finalise —
   * unless run.sh already did (re-read right before writing). The unit going
   * away without run.sh recording an end means the exitcode file is the only
   * truth left; absent that, the job genuinely died.
   */
  private async watchUnit(record: JobRecord, file: string) {
    const unit = record.unit!;
    while ((await unitState(unit)) === 'active') {
      await new Promise((r) => setTimeout(r, unitPollMs));
    }
    try {
      const current = JSON.parse(await fsp.readFile(file, 'utf-8')) as JobRecord;
      if (current.status !== 'running') return;
      const sentinel = await readExitSentinel(current.id);
      if (sentinel !== null) {
        current.status = 'exited';
        current.exitCode = sentinel;
        current.exitSource = 'sentinel';
      } else {
        current.status = 'killed';
        current.exitSource = 'unknown';
      }
      current.endedAt = new Date().toISOString();
      await fsp.writeFile(file, JSON.stringify(current, null, 2));
    } catch {
      // Pruned or unreadable — nothing to finalise.
    }
  }

  /**
   * A job that survived a restart has no live parent to reap it. Poll until
   * its process is gone, then record an honest terminal state. The exit code
   * is read back from the scope's own sentinel, so a job that finished while
   * sam-ui was down keeps its real result instead of being filed as unknown;
   * only a scope torn down before it could write leaves a null code — and
   * under the dashboard's failure rules a null-code 'exited' is not a failure.
   */
  private async watchOrphan(record: JobRecord, file: string) {
    const pid = record.pid!;
    const start = record.procStart ?? null;
    while (processAlive(pid, start)) {
      await new Promise((r) => setTimeout(r, 5_000));
    }
    try {
      const raw = await fsp.readFile(file, 'utf-8');
      const current = JSON.parse(raw) as JobRecord;
      if (current.status === 'running') {
        // The original parent is gone, but the scope wrote its own result on
        // the way out — so the code is recoverable after all.
        const sentinel = await readExitSentinel(current.id);
        current.status = 'exited';
        current.exitCode = sentinel;
        current.exitSource = sentinel !== null ? 'sentinel' : 'unknown';
        current.endedAt = new Date().toISOString();
        await fsp.writeFile(file, JSON.stringify(current, null, 2));
      }
    } catch {
      // Pruned or unreadable — nothing to finalise.
    }
  }

  /** True if the job has a live process in this process's memory. */
  isLive(id: string): boolean {
    return this.jobs.has(id);
  }

  /** The record for a job this process is actively running, read from
   *  memory only — never disk. `null` once the job has exited (even though
   *  its meta file still exists) or for a job this process never spawned.
   *  Review finding 7: `chatActions.ts`'s `openChat` needs an authoritative
   *  `startedAt` for a turn it already knows (via the session lock) is still
   *  running, synchronously, without the async disk read `get()` would need. */
  liveRecord(id: string): JobRecord | null {
    const running = this.jobs.get(id);
    return running ? { ...running.record } : null;
  }

  /** Current size in bytes of a job's stdout log, or 0 if it does not exist
   *  yet. A sam-job record's on-disk JSON never carries `lastSeq` (see
   *  `isSamJobShape`), so the stream route cannot poll "is there new output"
   *  the way it does for a JobManager-spawned job (`lastSeq` advancing) —
   *  review finding 11 polls the log file's size instead. */
  async outputSize(id: string): Promise<number> {
    try {
      const stat = await fsp.stat(stdoutPath(id));
      return stat.size;
    } catch {
      return 0;
    }
  }

  /** Create and start a new job from a raw shell command string. */
  async create(command: string): Promise<JobRecord> {
    const { record, output } = await this.prepare(command);

    // Spawn inside its own transient systemd scope (sibling of sam-ui.service)
    // so a `systemctl restart sam-ui` can no longer kill this job — a bare
    // spawn inherits the server's cgroup and dies with it. `--quiet` keeps the
    // scope banner out of the stream; the scope is collected on exit.
    const child = spawn(
      'systemd-run',
      [
        '--user',
        '--scope',
        '--quiet',
        '--collect',
        // systemd expands `$NAME` in argv by default: a chat message starting
        // "$100 …" became an empty prompt, and one naming a server env var
        // would have had its value pasted in. Leave `$` to bash and the CLI.
        '--expand-environment=no',
        // The inner `bash -c` keeps the Terminal's shell semantics; the wrapper
        // around it records the exit code so a sam-ui restart can't lose it.
        ...withExitSentinel(['bash', '-c', command]),
      ],
      {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: os.homedir(),
        env: mergeEnv({
          SAM_EXIT_FILE: exitCodePath(record.id),
          SAM_CGROUP_FILE: cgroupFilePath(record.id),
          // `.env.local` puts ANTHROPIC_* on process.env, so a raw child would
          // inherit them — typing `claude` in the Terminal would silently route
          // to DeepSeek. Strip them so the CLI talks to Claude, matching the Max
          // chat tier and fleet dispatch.
          ANTHROPIC_BASE_URL: null,
          ANTHROPIC_AUTH_TOKEN: null,
          ANTHROPIC_API_KEY: null,
          ANTHROPIC_MODEL: null,
          // The SessionStart hook launches a visualiser and a voice-line terminal
          // tab — noise for a job whose output already streams in the Terminal.
          SAM_SKIP_SERVICE_LAUNCH: '1',
        }),
      },
    );

    return this.attach(record, child, output, {});
  }

  /**
   * Create and start a job from an argv array, with no shell involved.
   *
   * Use this whenever any argument contains untrusted or free-form text (a
   * chat message, a filename): `shell: false` means backticks, `$(...)`, and
   * friends are passed through as literal characters instead of being
   * interpreted. `create()` keeps its shell semantics for the Terminal, where
   * the operator is deliberately typing shell.
   */
  async createArgs(
    bin: string,
    args: string[],
    opts: CreateArgsOptions = {},
  ): Promise<JobRecord> {
    // The label is display-only — it is never executed.
    const label = opts.label ?? [bin, ...args].join(' ');
    const { record, output } = await this.prepare(label);

    // Same cgroup-escape as create(): run in a transient sibling scope so the
    // job outlives a sam-ui restart. shell:false semantics preserved — bin and
    // args pass through systemd-run as literal argv.
    const child = spawn(
      'systemd-run',
      [
        '--user',
        '--scope',
        '--quiet',
        '--collect',
        '--expand-environment=no', // see create(): `$` in a prompt must reach the CLI verbatim
        ...withExitSentinel([bin, ...args]),
      ],
      {
        shell: false,
        // stdin is /dev/null here by default, not a pipe. Nothing writes to a
        // createArgs job's stdin, and the CLI blocks on a pipe it never hears
        // from: it warns at 3s and then proceeds, which costs ~2.9s a turn
        // (measured 5.2s open-pipe vs 2.3s /dev/null, timing the CLI alone).
        // The wait happens before a model is chosen, so it is the same on
        // every tier. A caller that actually intends to write to stdin (a
        // chat turn streaming its prompt in) passes `stdin: 'pipe'`.
        //
        // create() keeps its pipe on purpose: the Terminal is the only caller
        // that types into stdin (jobsService.sendInput), and a terminal job
        // with /dev/null stdin would silently swallow every keystroke.
        stdio: [opts.stdin ?? 'ignore', 'pipe', 'pipe'],
        cwd: opts.cwd ?? os.homedir(),
        env: mergeEnv({
          ...(opts.env ?? {}),
          SAM_EXIT_FILE: exitCodePath(record.id),
          SAM_CGROUP_FILE: cgroupFilePath(record.id),
        }),
      },
    );

    return this.attach(record, child, output, opts);
  }

  /** Allocate an ID, output writer and initial record. */
  private async prepare(command: string) {
    await this.ensure();

    const id = nextId();
    const output = new OutputWriter(id);
    await output.init();

    const record: JobRecord = {
      id,
      command,
      status: 'queued',
      exitCode: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      outputBytes: 0,
      lastSeq: 0,
    };

    return { record, output };
  }

  /** Wire up a spawned child's lifecycle and register it as running. */
  private async attach(
    record: JobRecord,
    child: ChildProcess,
    output: OutputWriter,
    opts: CreateArgsOptions,
  ): Promise<JobRecord> {
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    // Identity for reconcileOrphans: the scope leader PID plus its start time,
    // so a boot-time liveness check can tell a surviving job from a dead one.
    // child.pid is undefined only when the spawn failed before assigning one.
    record.pid = child.pid ?? undefined;
    record.procStart = child.pid ? procStartTicks(child.pid) ?? undefined : undefined;

    // Register handlers BEFORE any await — fast-exiting commands (bare echo,
    // etc.) can finish during the first I/O and we must not miss the close
    // or data events.

    const lineState: StdoutLineState = { midLine: false, deferred: [] };

    const onData = async (chunk: Buffer, isStdout: boolean) => {
      // Every write is queued synchronously, in arrival order, so any deferred
      // marker lands right after the chunk that completed the line.
      const writes: Promise<number>[] = [output.write(chunk)];
      const sizes: number[] = [chunk.length];
      if (isStdout && chunk.length > 0) {
        lineState.midLine = chunk[chunk.length - 1] !== 0x0a;
        if (!lineState.midLine) {
          for (const marker of lineState.deferred.splice(0)) {
            const buf = Buffer.from(marker);
            writes.push(output.write(buf));
            sizes.push(buf.length);
          }
        }
      }
      for (let i = 0; i < writes.length; i++) {
        const seq = await writes[i];
        if (seq > 0) {
          record.lastSeq = seq;
          record.outputBytes += sizes[i];
        }
      }
      if (isStdout) opts.onOutputChunk?.(chunk, record);
    };

    child.stdout?.on('data', (chunk: Buffer) => void onData(chunk, true));
    child.stderr?.on('data', (chunk: Buffer) => void onData(chunk, false));

    // Without this, a write after the child has closed its read end or
    // exited (a side message landing in the instant after the turn ends)
    // raises an EPIPE 'error' on this stream with no listener — an uncaught
    // exception that crashes the whole sam-ui server. The caller learns of
    // the failure from the write callback (see deliverSideMessage), not here.
    child.stdin?.on('error', () => {});

    child.on('close', async (code, signal) => {
      // Drain queued output BEFORE the record says the job is finished. Marking
      // it exited first let the stream route read a stale `lastSeq`, send
      // `closed`, and leave the client finalising a transcript whose tail was
      // still being written — measured: the file stopped at line 2970 of 4000
      // while the record claimed lastSeq 299.
      // A marker still waiting for a line boundary that never came goes in now,
      // on a line of its own, so it is not lost.
      for (const marker of lineState.deferred.splice(0)) {
        await output.write((lineState.midLine ? '\n' : '') + marker).catch(() => 0);
        lineState.midLine = false;
      }
      await output.close();
      record.status = code === null ? 'killed' : 'exited';
      // Node reports `code: null` whenever a signal did the killing, so the
      // signal is the only thing that separates a restart SIGTERM from an OOM
      // SIGKILL from a user cancel. Dropping it made all three look identical.
      record.signal = signal ?? null;
      // The wrapper's own code is the payload's code, so the handle stays
      // authoritative when the parent is alive to reap it. Fall back to the
      // sentinel if a signal robbed us of a code but the scope still wrote one.
      record.exitCode = code ?? (await readExitSentinel(record.id));
      record.exitSource = code !== null ? 'parent' : record.exitCode !== null ? 'sentinel' : 'unknown';
      record.endedAt = new Date().toISOString();
      await this.writeMeta(record);
      this.jobs.delete(record.id);
      this.stdinChains.delete(record.id);
      this.completedIds.push(record.id);
      this.prune();

      if (opts.onExit) {
        // Detached and swallowed: the job is already done and recorded, so a
        // failing reporter must not surface as a job failure.
        void Promise.resolve(opts.onExit(record)).catch(() => {});
      }
    });

    child.on('error', async (err) => {
      const chunk = Buffer.from(`\n[SAM] process error: ${err.message}\n`, 'utf-8');
      await output.write(chunk);
    });

    // Now persist the initial meta (handlers are already armed).
    await this.writeMeta(record);

    const running: RunningJob = { record, process: child, output, lineState };
    this.jobs.set(record.id, running);
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

  /**
   * Kill a running job.
   *
   * Signals the job's SCOPE, not the recorded pid. `record.pid` is the scope
   * leader — the `bash -c` wrapper from withExitSentinel, which systemd-run
   * execs in place — and bash does not forward a signal it is handed. Killing
   * the leader alone therefore killed the wrapper and *orphaned the payload*:
   * the agent was reparented to the user manager and carried on running (and
   * billing) while this method returned true and the API reported the job
   * killed. Measured 2026-09-10: a job stopped at 18:09 still had its process
   * alive and its scope `active running` ten minutes later — the "stop does
   * nothing and I can't kill it either" report.
   *
   * The scope's cgroup holds the payload and every process it spawned, so
   * signalling the scope reaches all of it in one go — including a payload
   * that called `setsid`, which a process-group signal would miss. See
   * scopeSignal() for why the process group is the wrong handle here.
   *
   * Graceful first, then the teardown: SIGTERM to the cgroup, and 3s later a
   * SIGKILL sweep and the unit unloaded. The escalation is unconditional — the
   * leader dying is exactly what used to mask a payload that ignored SIGTERM,
   * so its exit code says nothing about whether the work is still running.
   */
  async kill(id: string): Promise<boolean> {
    const running = this.jobs.get(id);
    if (!running) return false;

    const unit = await readScopeUnit(id);

    if (unit) {
      scopeSignal(unit, 'SIGTERM');
      setTimeout(() => teardownScope(unit), 3000);
      return true;
    }

    // No cgroup recorded: the job was spawned microseconds ago and the wrapper
    // has not written it yet. Signal the leader to get the stop moving, then
    // re-read a moment later — by then the file is there and the scope can be
    // torn down properly, rather than leaving an empty scope behind.
    try {
      running.process.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    setTimeout(() => {
      void readScopeUnit(id).then((late) => {
        if (late) teardownScope(late);
      });
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

  /** Close a job's stdin, signalling EOF to the child. `false` if the job
   *  isn't live in this process. */
  closeStdin(id: string): boolean {
    const running = this.jobs.get(id);
    if (!running) return false;
    try {
      running.process.stdin?.end();
      return true;
    } catch {
      return false;
    }
  }

  /** Per-job chain of pending stdin deliveries, so two calls for the same id
   *  made without awaiting the first between them still write in the order
   *  `deliverSideMessage` was *called*, never interleaved (check 12). */
  private stdinChains = new Map<string, Promise<void>>();

  /** Write a line to a job's stdin and append a marker line to its own output
   *  log, as one ordered unit. `false` if the job is not live, not running,
   *  or its stdin is not writable (e.g. a reattached job after a sam-ui
   *  restart, which has no stdin handle in this process). */
  async deliverSideMessage(id: string, stdinLine: string, markerLine: string): Promise<boolean> {
    const prev = this.stdinChains.get(id) ?? Promise.resolve();
    let ok = false;
    const next = prev.then(async () => {
      const running = this.jobs.get(id);
      if (!running || running.record.status !== 'running' || !running.process.stdin?.writable) return;
      try {
        await new Promise<void>((resolve, reject) => {
          running.process.stdin!.write(stdinLine, (err) => (err ? reject(err) : resolve()));
        });
        await deliverHook?.(markerLine);
        if (running.lineState.midLine) {
          // The last stdout chunk ended part-way through a line: a marker
          // written now would split it. The next chunk that ends a line (or
          // the job's close) writes it.
          running.lineState.deferred.push(markerLine);
        } else {
          const seq = await running.output.write(Buffer.from(markerLine));
          if (seq > 0) {
            running.record.lastSeq = seq;
            running.record.outputBytes += markerLine.length;
          }
        }
        ok = true;
      } catch {
        // ok stays false; the write failed (e.g. EPIPE) and no marker is appended
      }
    });
    this.stdinChains.set(id, next.catch(() => {}));
    await next;
    return ok;
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

  /**
   * Retention sweep over the job store ON DISK.
   *
   * `prune()` above only ever walked `completedIds`, which is an *in-process*
   * array of jobs this server instance happened to finish. It is empty after
   * every restart, so nothing a previous instance created was ever collected —
   * the cap and the retention window were both dead letters. Measured
   * 2026-09-20: 834 job directories, 491 MB, oldest 11 days, against a declared
   * MAX_JOBS of 128 and a 7-day window. The store had never once been swept.
   *
   * Runs at boot alongside reconcileOrphans (which already reads this directory,
   * so the listing is not a new cost) and hourly after that, because a server
   * that stays up for days would otherwise not sweep again until it restarted.
   *
   * Deliberately conservative about what it will delete:
   *   - never a job that is live in this process (`this.jobs`)
   *   - never a job whose meta still says 'running' and whose process is alive;
   *     a job that outlived a restart in its own systemd scope is still working
   *   - never a directory whose name does not parse as one of ours
   *
   * Age comes from the id's own base-36 timestamp segment, falling back to the
   * directory mtime when that is unparseable, so a pre-format directory is aged
   * out rather than kept forever.
   */
  private async sweepDisk() {
    let entries;
    try {
      entries = await fsp.readdir(JOBS_ROOT, { withFileTypes: true });
    } catch {
      return;
    }

    const cutoff = Date.now() - RETENTION_MS;
    const candidates: { id: string; ts: number }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('job_')) continue;
      const id = entry.name;

      // Live in this process — the close handler owns its lifecycle.
      if (this.jobs.has(id)) continue;

      let ts = Number.NaN;
      const tsPart = id.split('_')[1];
      if (tsPart) ts = parseInt(tsPart, 36);
      // sam-job ids are `job_<slug>_<YYYYMMDD-HHMMSS>`: the slug parses as a
      // base-36 number in 1970, which aged every one of them out at the next
      // sweep, running or not (2026-09-26). Only trust a plausible timestamp.
      if (!(ts >= MIN_PLAUSIBLE_TS && ts <= Date.now() + 86_400_000)) ts = Number.NaN;
      if (!Number.isFinite(ts) || ts <= 0) {
        // Unparseable id (pre-format, or hand-made like job_curate-2026-09-09_…).
        // Fall back to the directory's own mtime rather than keeping it forever.
        try {
          ts = (await fsp.stat(jobDir(id))).mtimeMs;
        } catch {
          continue;
        }
      }

      candidates.push({ id, ts });
    }

    // Newest first, so the count-based cut keeps the most recent MAX_JOBS.
    candidates.sort((a, b) => b.ts - a.ts);

    const doomed = candidates.filter(
      ({ ts }, index) => ts < cutoff || index >= MAX_JOBS,
    );

    let removed = 0;
    for (const { id } of doomed) {
      // A record still claiming 'running' with a live process is a job that
      // survived a restart in its own scope. Age says delete; the process says
      // it is mid-flight. The process wins — deleting its directory out from
      // under it would destroy the output it is still writing.
      try {
        const record = JSON.parse(
          await fsp.readFile(metaPath(id), 'utf-8'),
        ) as JobRecord;
        if (
          record.status === 'running' &&
          record.pid &&
          processAlive(record.pid, record.procStart ?? null)
        ) {
          continue;
        }
        // Jobs launched outside this server (sam-job) record no pid, so the
        // check above cannot see them. Still unfinished and touched inside the
        // retention window means still working: keep it.
        if (
          !record.pid &&
          (record.status === 'running' || record.status === 'queued') &&
          (await fsp.stat(jobDir(id))).mtimeMs >= cutoff
        ) {
          continue;
        }
      } catch {
        // No readable meta — a half-written or abandoned directory. Collect it.
      }

      try {
        await fsp.rm(jobDir(id), { recursive: true, force: true });
        removed++;
      } catch {
        // Locked or already gone; the next sweep will retry.
      }
    }

    if (removed > 0) {
      console.log(
        `[jobs] retention sweep removed ${removed} job dir(s); ${
          candidates.length - removed
        } retained`,
      );
    }
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
