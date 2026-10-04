/**
 * SAM — `meta.json` gets an explicit `tier` field at dispatch time (staged,
 * ux-fixes T4).
 *
 * Spec: must-do 2 (tier half); check 1 (tier half). `sam-dispatch` already
 * computes `MODEL` from `--tier` (`sam-dispatch:64-70`) but never passed the
 * tier string itself to `sam-job` — only `$SUMMARY` (default "$NAME
 * ($TIER)") carried it, buried in text. `sam-job` already accepts
 * `--general`/`--stages` the same way (`sam-job:54-73`) and writes them into
 * `meta.json` via its inline Python heredoc (`sam-job:140-161`). This ticket
 * adds one more pass-through flag, `--tier`, the same way, so `meta.json`
 * carries an explicit `"tier"` field instead of leaving it buried.
 *
 * This runs the STAGED copies (`sam-dispatch.next`, `sam-job.next`) when they
 * exist, else the live files, so it still holds once a later ticket installs
 * them. Binary selection honours an env override first
 * (`SAM_DISPATCH_BIN_UNDER_TEST` / `SAM_JOB_BIN_UNDER_TEST`), matching the
 * pattern `samDispatchBrief.test.ts` and `samJobEvents.test.ts` already use
 * (the former calls its dispatch override `SAM_DISPATCH_BIN`; this file
 * follows `samJobEvents.test.ts`'s `_UNDER_TEST` suffix convention for both
 * binaries since both are varied here), so the before/after proof below is
 * reproducible without editing this file:
 *   - before (fails): `SAM_JOB_BIN_UNDER_TEST=/home/col/.local/bin/sam-job
 *     npm test src/lib/server/fleet/samDispatchTier.test.ts` — the live
 *     `sam-job` never writes a `tier` field into `meta.json`; the "direct"
 *     case below fails, asserting `meta.tier` is `undefined`.
 *   - after (passes): plain `npm test src/lib/server/fleet/samDispatchTier.test.ts`
 *     — resolves `sam-job.next` (and `sam-dispatch.next` for the dispatch
 *     case), both of which write `"tier": "<tier>"` into `meta.json`.
 *
 * BOX-ONLY: the resolved binaries live under `/home/col/.local/bin`, present
 * only on Colin's box (and only there does `systemd-run --user` exist to run
 * a real job against). On a GitHub-hosted runner this reports SKIPPED with
 * its reason (see boxOnly.ts).
 *
 * It never touches live state: `HOME` and `SAM_JOB_STORE` are fresh temp
 * dirs per case (never `~/.sam/jobs`), `SAM_PUSH_BIN`/`SAM_PUSH_SUBS`/
 * `SAM_PUSH_LOG` point at stubs/temp files (no case passes `--notify`, so no
 * ping is even attempted), and every job runs only `true` — never a real
 * command. Each case waits for its own job to finish before moving on and
 * best-effort stops the transient systemd unit afterwards.
 */

import assert from 'node:assert/strict';
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
const DISPATCH_BIN = resolveBinary(
  'SAM_DISPATCH_BIN_UNDER_TEST',
  '/home/col/.local/bin/sam-dispatch.next',
  '/home/col/.local/bin/sam-dispatch',
);

const SKIP = boxOnlySkip('the real sam-job/sam-dispatch (or their staged .next copies)', [
  JOB_BIN,
  DISPATCH_BIN,
]);

const JOB_TIMEOUT_MS = 30_000;

interface JobMeta {
  id: string;
  status: string;
  exitCode: number | null;
  tier?: string | null;
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
  const tmp = tempDir('sam-dispatch-tier-');
  const home = path.join(tmp, 'home');
  const store = path.join(tmp, 'jobs');
  const cwd = path.join(tmp, 'cwd');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  const pushBin = path.join(tmp, 'stub-push');
  fs.writeFileSync(pushBin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(pushBin, 0o755);

  const pushSubs = path.join(tmp, 'push-subs.json');
  fs.writeFileSync(pushSubs, '[]');
  const pushLog = path.join(tmp, 'push-log.jsonl');

  return { tmp, home, store, cwd, pushBin, pushSubs, pushLog };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for a job dir's meta.json to reach a finished status, returning the
 * parsed meta. There must be exactly one job in `store`. */
async function waitForJob(store: string): Promise<JobMeta> {
  const jobs = fs.readdirSync(store);
  assert.equal(jobs.length, 1, `exactly one job in the temp store, got: ${jobs.join(', ')}`);
  const metaFile = path.join(store, jobs[0], 'meta.json');

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
    `job did not finish within ${JOB_TIMEOUT_MS / 1000}s (status ${meta?.status})`,
  );
  return meta as JobMeta;
}

let jobSeq = 0;
/** Unique per call: sam-job's unit is `sam-job-<slug>-<epoch s>`, so a fixed
 * or default slug collides with other test files launching jobs in the same
 * second ("unit already exists"). */
function uniqueName(label: string): string {
  return `${label}-${process.pid}-${jobSeq++}`;
}

test(
  'sam-job --tier writes an explicit tier field into meta.json',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const r = spawnSync(
      JOB_BIN,
      ['--name', uniqueName('tier'), '--general', 'cerberus', '--stages', 'Scan,Report', '--tier', 'sonnet', '--', 'true'],
      {
        cwd: ctx.cwd,
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          // sam-dispatch execs the job, so it never removes its mktemp work copy of the brief; keep it in the sandbox.
          TMPDIR: ctx.tmp,
          HOME: ctx.home,
          SAM_JOB_STORE: ctx.store,
          SAM_PUSH_BIN: ctx.pushBin,
          SAM_PUSH_SUBS: ctx.pushSubs,
          SAM_PUSH_LOG: ctx.pushLog,
          SAM_CHAT_ID: '',
          SAM_ORIGIN: '',
        },
      },
    );
    assert.equal(r.status, 0, `sam-job failed: ${r.stderr}\n${r.stdout}`);

    const unitMatch = /unit=(\S+)/.exec(r.stdout ?? '');
    const unit = unitMatch?.[1];

    const meta = await waitForJob(ctx.store);
    assert.equal(meta.exitCode, 0);

    if (unit) spawnSync('systemctl', ['--user', 'stop', unit], { timeout: 5_000 });

    // This is the before/after proof: against the live sam-job (no .next,
    // and no SAM_JOB_BIN_UNDER_TEST override pointing at .next), --tier is
    // an unrecognised argument that falls through to "break" in the arg
    // parser, so it (and everything after it) is treated as the start of
    // the command — meta.json's "tier" field is simply absent, i.e.
    // undefined once parsed back. Against sam-job.next, it is the literal
    // tier string passed.
    assert.equal(meta.tier, 'sonnet');
  },
);

test(
  'sam-dispatch --tier threads the tier through to sam-job, into meta.json',
  { skip: SKIP, timeout: JOB_TIMEOUT_MS + 10_000 },
  async () => {
    const ctx = makeCtx();
    const brief = path.join(ctx.tmp, 'brief.md');
    fs.writeFileSync(
      brief,
      ['Task type: build', 'General: cerberus', 'Stages: Scan, Report', '', 'Run `true`.', ''].join('\n'),
    );

    const r = spawnSync(
      DISPATCH_BIN,
      ['--tier', 'sonnet', '--brief', brief, '--cwd', ctx.cwd, '--name', uniqueName('dtier')],
      {
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          TMPDIR: ctx.tmp,
          HOME: ctx.home,
          SAM_JOB_STORE: ctx.store,
          SAM_JOB_BIN: JOB_BIN,
          SAM_DISPATCH_LOG: path.join(ctx.tmp, 'dispatch.log'),
          SAM_PUSH_BIN: ctx.pushBin,
          SAM_PUSH_SUBS: ctx.pushSubs,
          SAM_PUSH_LOG: ctx.pushLog,
          SAM_CHAT_ID: '',
          SAM_ORIGIN: '',
        },
      },
    );
    // sam-dispatch's exec line launches `claude -p` via sam-job, which is
    // never actually reached in a CI-safe way (no real Claude credentials
    // here) — but sam-job itself writes meta.json before systemd-run starts
    // the unit, and that write is all this test needs to check. A failing
    // worker command inside the unit does not block that initial write or
    // this assertion.
    assert.equal(r.status, 0, `sam-dispatch failed: ${r.stderr}\n${r.stdout}`);

    const jobs = fs.readdirSync(ctx.store);
    assert.equal(jobs.length, 1, `exactly one job in the temp store, got: ${jobs.join(', ')}`);
    const metaFile = path.join(ctx.store, jobs[0], 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as JobMeta;

    assert.equal(meta.tier, 'sonnet');

    // Best-effort stop: the unit will fail fast (no real claude creds), but
    // give it a moment and stop whatever transient unit it started so none
    // are left running/failed in `systemctl --user`.
    await sleep(1000);
    const unitMatch = /unit=(\S+)/.exec(r.stdout ?? '');
    if (unitMatch?.[1]) {
      spawnSync('systemctl', ['--user', 'stop', unitMatch[1]], { timeout: 5_000 });
    }
  },
);
