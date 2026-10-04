/**
 * SAM — `sam-stage`: worker-side stage event helper (staged, visual-upgrade
 * T4).
 *
 * Spec: must-do 16c, 16d; check 10. A job's own cmd.sh calls
 * `sam-stage start <stage>` / `sam-stage done <stage>` as it works through
 * the stages its brief declared, appending to the same `events.jsonl`
 * `run.next.sh` (T3) writes `dispatched`/`started`/`ended` to. It must
 * refuse a stage that isn't in the job's own planned list (`meta.json`'s
 * `stages` array), writing nothing in that case.
 *
 * Binary selection (T4 foreman's note): `SAM_STAGE_BIN_UNDER_TEST` env
 * override if set, else `sam-stage.next` if present, else the live
 * `sam-stage` (so this test still holds once T23 installs it and retires
 * the `.next` copy).
 *
 * T4's own before/after proof (there is no live `sam-stage` yet, so the
 * "before" run is against a deliberately missing path, not a live binary):
 *   - before (fails): `SAM_STAGE_BIN_UNDER_TEST=/home/col/.local/bin/sam-stage.does-not-exist npm test`
 *     — every case below fails (ENOENT / status null), because the script
 *     doesn't exist yet.
 *   - after (passes): plain `npm test` — resolves `sam-stage.next`.
 *
 * BOX-ONLY: the resolved binary lives under `/home/col/.local/bin`, and the
 * optional end-to-end case also needs `sam-job.next` + `run.next.sh` under
 * `/home/col`, present only on Colin's box. On a GitHub-hosted runner this
 * reports SKIPPED with its reason (see boxOnly.ts) rather than failing for a
 * reason unrelated to the code under test.
 *
 * It never touches live state: every case uses its own temp job dir (never
 * `~/.sam/jobs`), and the end-to-end case points `SAM_JOB_STORE` at a temp
 * dir, `SAM_PUSH_BIN` at a stub, `SAM_PUSH_SUBS`/`SAM_PUSH_LOG` at temp
 * files, and never passes `--notify` — the same seams
 * `samJobEvents.test.ts` uses. The job it runs calls nothing but
 * `sam-stage.next` itself.
 */

import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
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

const STAGE_BIN = resolveBinary(
  'SAM_STAGE_BIN_UNDER_TEST',
  '/home/col/.local/bin/sam-stage.next',
  '/home/col/.local/bin/sam-stage',
);
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

// Deliberately NOT gated on STAGE_BIN's own existence: unlike sam-dispatch/
// sam-job (which already live at their default paths, just lacking the
// behaviour under test), there is no live sam-stage yet, so "the script is
// missing" is exactly the pre-T4 state these tests must genuinely FAIL
// against (not silently skip). Colin's box itself is still the gate, via a
// generic marker that only exists there, so a hosted CI runner (which also
// lacks sam-job/run.sh, systemd --user, etc.) still reports SKIPPED rather
// than failing for an unrelated reason.
const SKIP = boxOnlySkip("Colin's box (sam-stage/.next lives under /home/col/.local/bin)", [
  '/home/col/.local/bin',
]);
const SKIP_E2E = boxOnlySkip('the real sam-job, run.sh (or their staged .next copies) and systemd --user', [
  JOB_BIN,
  RUN_SH,
]);

interface EventLine {
  type: string;
  stage?: string;
  at?: string;
  exitCode?: number;
  general?: string | null;
  stages?: unknown;
}

interface JobFixture {
  dir: string;
  eventsPath: string;
}

/** A fresh temp job dir per case: meta.json with the given planned stages
 * (or no stages field at all when `stages` is null) and an empty
 * events.jsonl, exactly as T3 leaves a freshly-dispatched job. */
function makeJobDir(stages: string[] | null): JobFixture {
  const dir = tempDir('sam-stage-job-');
  const meta: Record<string, unknown> = { id: path.basename(dir), status: 'running' };
  if (stages !== null) meta.stages = stages;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  const eventsPath = path.join(dir, 'events.jsonl');
  fs.writeFileSync(eventsPath, '');
  return { dir, eventsPath };
}

function readEvents(eventsPath: string): EventLine[] {
  const text = fs.readFileSync(eventsPath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EventLine);
}

function runStage(
  job: JobFixture,
  args: string[],
  envOverride: Record<string, string | undefined> = {},
): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SAM_JOB_DIR: job.dir,
    SAM_JOB_EVENTS: job.eventsPath,
  };
  for (const [key, value] of Object.entries(envOverride)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(STAGE_BIN, args, { encoding: 'utf8', timeout: 10_000, env });
}

test(
  'start then done append stage-start/stage-done in order, each timestamped',
  { skip: SKIP },
  () => {
    const job = makeJobDir(['Scan', 'Report']);

    const r1 = runStage(job, ['start', 'Scan']);
    assert.equal(r1.status, 0, `start Scan failed: ${r1.stderr}`);

    const r2 = runStage(job, ['done', 'Scan']);
    assert.equal(r2.status, 0, `done Scan failed: ${r2.stderr}`);

    const events = readEvents(job.eventsPath);
    assert.equal(events.length, 2, `expected exactly 2 events, got: ${JSON.stringify(events)}`);
    assert.equal(events[0].type, 'stage-start');
    assert.equal(events[0].stage, 'Scan');
    assert.equal(events[1].type, 'stage-done');
    assert.equal(events[1].stage, 'Scan');

    for (const [label, event] of [
      ['stage-start', events[0]],
      ['stage-done', events[1]],
    ] as const) {
      assert.equal(typeof event.at, 'string', `${label} event must carry a timestamp`);
      assert.ok(!Number.isNaN(Date.parse(event.at as string)), `${label}'s "at" must parse as a date`);
    }
    assert.ok(
      Date.parse(events[1].at as string) >= Date.parse(events[0].at as string),
      'stage-done must not be timestamped before its own stage-start',
    );
  },
);

test('an unplanned stage is refused: exit non-zero, nothing written', { skip: SKIP }, () => {
  const job = makeJobDir(['Scan', 'Report']);
  const r = runStage(job, ['start', 'Nope']);
  assert.notEqual(r.status, 0, `expected refusal, got status ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /Nope/, 'stderr should name the refused stage');
  assert.equal(readEvents(job.eventsPath).length, 0, 'a refused stage must write nothing');
});

test('stage matching is exact and case-sensitive', { skip: SKIP }, () => {
  const job = makeJobDir(['Scan', 'Report']);
  const r = runStage(job, ['start', 'scan']);
  assert.notEqual(r.status, 0, `expected refusal for case mismatch, got status ${r.status}: ${r.stderr}`);
  assert.equal(readEvents(job.eventsPath).length, 0, 'a case-mismatched stage must write nothing');
});

test('a bad subcommand exits non-zero', { skip: SKIP }, () => {
  const job = makeJobDir(['Scan']);
  const r = runStage(job, ['poke', 'Scan']);
  assert.notEqual(r.status, 0, `expected refusal for a bad subcommand, got status ${r.status}: ${r.stderr}`);
  assert.equal(readEvents(job.eventsPath).length, 0);
});

test(
  'with neither SAM_JOB_DIR nor SAM_JOB_EVENTS set, exits non-zero with a clear message',
  { skip: SKIP },
  () => {
    const job = makeJobDir(['Scan']);
    const r = runStage(job, ['start', 'Scan'], { SAM_JOB_DIR: undefined, SAM_JOB_EVENTS: undefined });
    assert.notEqual(r.status, 0, `expected failure with no env set, got status ${r.status}`);
    assert.ok((r.stderr ?? '').length > 0, 'must explain itself on stderr');
    assert.equal(readEvents(job.eventsPath).length, 0);
  },
);

// --- optional end-to-end case: a real short job through sam-job.next + ---
// --- run.next.sh, calling sam-stage.next from inside cmd.sh -------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test(
  'a real job records dispatched, started, each stage event, and ended in order',
  { skip: SKIP_E2E, timeout: 40_000 },
  async () => {
    const tmp = tempDir('sam-stage-e2e-');
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

    // The job's own command: nothing but two sam-stage.next calls, via the
    // resolved absolute path (no live `sam-stage` exists yet to find on
    // PATH, by design of this ticket).
    const cmd = `'${STAGE_BIN}' start Scan && '${STAGE_BIN}' done Scan`;

    const r = spawnSync(
      JOB_BIN,
      // Unique --name: the default slug ("bash") would collide on the unit name
      // with any other job launched in the same second.
      ['--name', `stage-${process.pid}`, '--general', 'cerberus', '--stages', 'Scan,Report', '--', 'bash', '-c', cmd],
      {
        cwd,
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          HOME: home,
          SAM_JOB_STORE: store,
          SAM_JOB_RUN_SH: RUN_SH,
          SAM_PUSH_BIN: pushBin,
          SAM_PUSH_SUBS: pushSubs,
          SAM_PUSH_LOG: pushLog,
          SAM_CHAT_ID: '',
          SAM_ORIGIN: '',
        },
      },
    );
    assert.equal(r.status, 0, `sam-job.next failed: ${r.stderr}\n${r.stdout}`);

    const unitMatch = /unit=(\S+)/.exec(r.stdout ?? '');
    const unit = unitMatch?.[1];

    const jobs = fs.readdirSync(store);
    assert.equal(jobs.length, 1, `exactly one job in the temp store, got: ${jobs.join(', ')}`);
    const jobDir = path.join(store, jobs[0]);
    const metaFile = path.join(jobDir, 'meta.json');

    const deadline = Date.now() + 30_000;
    let status: string | undefined;
    while (Date.now() < deadline) {
      try {
        status = (JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { status?: string }).status;
      } catch {
        status = undefined;
      }
      if (status === 'exited' || status === 'failed') break;
      await sleep(300);
    }
    assert.ok(
      status === 'exited' || status === 'failed',
      `job did not finish in time (status ${status})`,
    );

    if (unit) spawnSync('systemctl', ['--user', 'stop', unit], { timeout: 5_000 });

    const events = readEvents(path.join(jobDir, 'events.jsonl'));
    assert.deepEqual(
      events.map((e) => (e.stage ? `${e.type}:${e.stage}` : e.type)),
      ['dispatched', 'started', 'stage-start:Scan', 'stage-done:Scan', 'ended'],
      `unexpected event order: ${JSON.stringify(events)}`,
    );
    assert.equal(events[events.length - 1].exitCode, 0);
  },
);
