/**
 * SAM — `sam-job` writes `events.jsonl` and records job origin (staged,
 * visual-upgrade T3).
 *
 * Spec: must-do 16b, 16d, 16e; check 10. `sam-job` must, by itself:
 *   - append a `dispatched`/`started`/`ended` line to a new `<job dir>/
 *     events.jsonl`, each with a timestamp (Must 16b, 16d);
 *   - record where the job came from — `chat` (a valid `SAM_CHAT_ID` reached
 *     the launching shell), `schedule` (`SAM_ORIGIN=schedule` was set) or
 *     `manual` (neither) — as `meta.json`'s `origin` field (Must 16e).
 *
 * This runs the STAGED copies (`sam-job.next`, `run.next.sh`) when they
 * exist, else the live files, so it still holds once T23 installs them.
 * Binary selection honours an env override first (`SAM_JOB_BIN_UNDER_TEST` /
 * `SAM_JOB_RUN_SH_UNDER_TEST`), so the before/after proof is reproducible
 * without editing this file:
 *   - before (fails): `SAM_JOB_BIN_UNDER_TEST=/home/col/.local/bin/sam-job
 *     SAM_JOB_RUN_SH_UNDER_TEST=/home/col/.sam/sam-job/run.sh npm test
 *     src/lib/server/fleet/samJobEvents.test.ts` — the live tools write
 *     neither `events.jsonl` nor an `origin` field.
 *   - after (passes): plain `npm test src/lib/server/fleet/samJobEvents.test.ts`
 *     — resolves `.next`/`run.next.sh`.
 *
 * BOX-ONLY: the resolved binaries live under `/home/col`, present only on
 * Colin's box (and only there does `systemd-run --user` exist to run a real
 * job against). On a GitHub-hosted runner this reports SKIPPED with its
 * reason (see boxOnly.ts).
 *
 * It never touches live state:
 *   - `HOME` and `SAM_JOB_STORE` are fresh temp dirs per case, so nothing
 *     lands in `~/.sam/jobs` — `sam-job` reads `SAM_JOB_STORE` directly
 *     (`STORE=${SAM_JOB_STORE:-/home/col/.sam/jobs}`), which is what
 *     actually matters since the systemd unit runs with Colin's real HOME
 *     regardless of this process's env (systemd-run does not inherit it).
 *   - `SAM_PUSH_BIN` points at a stub that records argv and exits 0,
 *     `SAM_PUSH_SUBS` at a temp file holding `[]`, `SAM_PUSH_LOG` at a temp
 *     path — the same three seams `dispatchPing.test.ts` uses, carried to
 *     the unit by `sam-job`'s own `--setenv` passthrough. No case here ever
 *     passes `--notify`, so no ping is even attempted, but the seams are set
 *     anyway as belt and braces.
 *   - every job runs only `true` or `false` — never a real command.
 *   - each case waits for its own job to finish (polling `meta.json`'s
 *     status with a timeout) before moving on, and best-effort stops the
 *     transient unit afterwards so none are left running or failed in
 *     `systemctl --user` (systemd's own `--collect` already removes a unit
 *     that has exited, so this is a backstop, not the primary cleanup).
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';

function resolveBinary(underTestEnv: string, staged: string, live: string): string {
  const override = process.env[underTestEnv];
  if (override) return override;
  return fs.existsSync(staged) ? staged : live;
}

const JOB_BIN = resolveBinary(
  'SAM_JOB_BIN_UNDER_TEST',
  '/home/col/.local/bin/sam-job.next',
  '/home/col/.local/bin/sam-job',
);
const RUN_SH = resolveBinary(
  'SAM_JOB_RUN_SH_UNDER_TEST',
  '/home/col/.sam/sam-job/run.next.sh',
  '/home/col/.sam/sam-job/run.sh',
);

const SKIP = boxOnlySkip('the real sam-job (or its staged .next copy) and run.sh', [
  JOB_BIN,
  RUN_SH,
]);

const JOB_TIMEOUT_MS = 30_000;

interface JobMeta {
  id: string;
  status: string;
  exitCode: number | null;
  origin?: string;
  general?: string | null;
  stages?: unknown;
}

interface EventLine {
  type: string;
  at?: string;
  exitCode?: number;
  general?: string | null;
  stages?: unknown;
}

interface Ctx {
  tmp: string;
  home: string;
  store: string;
  cwd: string;
  pushBin: string;
  pushSubs: string;
  pushLog: string;
}

/** A fresh sandbox per case: its own HOME, job store, cwd and push stubs. */
function makeCtx(): Ctx {
  const tmp = tempDir('sam-job-events-');
  const home = path.join(tmp, 'home');
  const store = path.join(tmp, 'jobs');
  const cwd = path.join(tmp, 'cwd');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const pushBin = path.join(tmp, 'stub-push');
  // Records argv (never used here — no case passes --notify — but wired in
  // defensively so no real push can ever fire even if that changed).
  fs.writeFileSync(
    pushBin,
    '#!/bin/sh\n' +
      'out="$(dirname "$0")/push-argv.txt"\n' +
      ': > "$out"\n' +
      'for a in "$@"; do printf \'%s\\n\' "$a" >> "$out"; done\n' +
      'exit 0\n',
  );
  fs.chmodSync(pushBin, 0o755);

  const pushSubs = path.join(tmp, 'push-subs.json');
  fs.writeFileSync(pushSubs, '[]');
  const pushLog = path.join(tmp, 'push-log.jsonl');

  return { tmp, home, store, cwd, pushBin, pushSubs, pushLog };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let jobSeq = 0;

/** Runs a real (but harmless) job via the resolved sam-job and waits for it
 * to finish. Returns the job's meta.json and parsed events.jsonl. */
async function runJob(
  ctx: Ctx,
  jobArgs: string[],
  extraEnv: Record<string, string>,
): Promise<{ id: string; dir: string; meta: JobMeta; events: EventLine[] }> {
  // Unique --name: sam-job's systemd unit is `sam-job-<slug>-<epoch s>`, and the
  // default slug is the command's first word, so parallel test files launching
  // `true` in the same second would collide ("unit already exists").
  const r = spawnSync(JOB_BIN, ['--name', `ev-${process.pid}-${jobSeq++}`, ...jobArgs], {
    cwd: ctx.cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      HOME: ctx.home,
      SAM_JOB_STORE: ctx.store,
      SAM_JOB_RUN_SH: RUN_SH,
      SAM_PUSH_BIN: ctx.pushBin,
      SAM_PUSH_SUBS: ctx.pushSubs,
      SAM_PUSH_LOG: ctx.pushLog,
      // Never ambient-leak either origin signal between cases.
      SAM_CHAT_ID: '',
      SAM_ORIGIN: '',
      ...extraEnv,
    },
  });
  assert.equal(r.status, 0, `sam-job failed: ${r.stderr}\n${r.stdout}`);

  const unitMatch = /unit=(\S+)/.exec(r.stdout ?? '');
  const unit = unitMatch?.[1];

  const jobs = fs.readdirSync(ctx.store);
  assert.equal(jobs.length, 1, `exactly one job in the temp store, got: ${jobs.join(', ')}`);
  const id = jobs[0];
  const dir = path.join(ctx.store, id);
  const metaFile = path.join(dir, 'meta.json');

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let meta: JobMeta | null = null;
  while (Date.now() < deadline) {
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as JobMeta;
    } catch {
      meta = null; // mid-write; try again
    }
    if (meta && (meta.status === 'exited' || meta.status === 'failed')) break;
    await sleep(300);
  }
  assert.ok(
    meta && (meta.status === 'exited' || meta.status === 'failed'),
    `job ${id} did not finish within ${JOB_TIMEOUT_MS / 1000}s (status ${meta?.status})`,
  );

  // Backstop cleanup: the unit should already be gone (systemd-run --collect
  // removes it once it exits), but stop it anyway in case of a slow
  // transition, so no stray unit is left behind.
  if (unit) {
    spawnSync('systemctl', ['--user', 'stop', unit], { timeout: 5_000 });
  }

  const events: EventLine[] = [];
  const eventsFile = path.join(dir, 'events.jsonl');
  if (fs.existsSync(eventsFile)) {
    for (const line of fs.readFileSync(eventsFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      events.push(JSON.parse(trimmed) as EventLine);
    }
  }

  return { id, dir, meta: meta as JobMeta, events };
}

function assertTimestamped(event: EventLine | undefined, label: string): void {
  assert.ok(event, `missing ${label} event`);
  assert.equal(typeof event?.at, 'string', `${label} event must carry a timestamp`);
  assert.ok(!Number.isNaN(Date.parse(event!.at as string)), `${label} event's "at" must parse as a date`);
}

test(
  'a job launched with a valid SAM_CHAT_ID records origin: chat',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const chatId = crypto.randomUUID();
    const { meta, events } = await runJob(ctx, ['--', 'true'], { SAM_CHAT_ID: chatId });

    assert.equal(meta.origin, 'chat');
    assert.equal(meta.exitCode, 0);

    assert.equal(events.length, 3, `expected dispatched/started/ended, got: ${JSON.stringify(events)}`);
    assert.equal(events[0].type, 'dispatched');
    assert.equal(events[1].type, 'started');
    assert.equal(events[2].type, 'ended');
    assertTimestamped(events[0], 'dispatched');
    assertTimestamped(events[1], 'started');
    assertTimestamped(events[2], 'ended');
    assert.equal(events[2].exitCode, 0);
  },
);

test(
  'a job launched with SAM_ORIGIN=schedule records origin: schedule',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const { meta, events } = await runJob(ctx, ['--', 'true'], { SAM_ORIGIN: 'schedule' });

    assert.equal(meta.origin, 'schedule');
    assert.equal(meta.exitCode, 0);
    assert.equal(events.map((e) => e.type).join(','), 'dispatched,started,ended');
    assert.equal(events[2].exitCode, 0);
  },
);

test(
  'a job launched with neither SAM_CHAT_ID nor SAM_ORIGIN records origin: manual',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const { meta, events } = await runJob(ctx, ['--', 'true'], {});

    assert.equal(meta.origin, 'manual');
    assert.equal(meta.exitCode, 0);
    assert.equal(events.map((e) => e.type).join(','), 'dispatched,started,ended');
    assert.equal(events[2].exitCode, 0);
  },
);

test(
  'a failed job still ends its events.jsonl, with the real non-zero exit code',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const { meta, events } = await runJob(ctx, ['--', 'false'], {});

    assert.equal(meta.origin, 'manual');
    assert.notEqual(meta.exitCode, 0);
    assert.equal(events.map((e) => e.type).join(','), 'dispatched,started,ended');
    assert.equal(events[2].exitCode, meta.exitCode);
    assert.notEqual(events[2].exitCode, 0);
  },
);

test(
  '--general/--stages are stored in meta.json and the dispatched event carries the planned stages',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const { meta, events } = await runJob(
      ctx,
      ['--general', 'cerberus', '--stages', 'Scan,Report', '--', 'true'],
      {},
    );

    assert.equal(meta.general, 'cerberus');
    assert.deepEqual(meta.stages, ['Scan', 'Report']);

    const dispatched = events.find((e) => e.type === 'dispatched');
    assert.ok(dispatched, 'missing dispatched event');
    assert.equal(dispatched?.general, 'cerberus');
    assert.deepEqual(dispatched?.stages, ['Scan', 'Report']);
  },
);
