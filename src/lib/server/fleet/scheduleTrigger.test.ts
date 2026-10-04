/**
 * SAM — a scheduled job's dispatch shows as the ring's trigger, not a double
 * job (visual-upgrade T19).
 *
 * Spec: must-do 16e (origin half), 27; check 29. A throwaway systemd user
 * timer runs `sam-dispatch` end to end, then this checks that exactly one
 * job exists and every reader agrees on it:
 *   - the job's `meta.json` says `origin: 'schedule'` (set by `sam-job` from
 *     the unit's `SAM_ORIGIN=schedule`, Must 16e);
 *   - `readFloorState()` places it once, under its General, with that
 *     origin, and nowhere else on the floor (no second "scheduled job");
 *   - `readScheduledJobs()` sees the timer and marks it
 *     `launchesFleetJob: true`;
 *   - `buildRing()` draws the timer as one tick whose firing sends a trigger
 *     light into SAM, and never a worker or a mark for the fleet job;
 *   - when the job ends, the floor has no worker left and one tower slab.
 *
 * Safety (ticket T19's Safety line; "Tests never launch real work"):
 *   - the timer runs the STAGED `sam-dispatch.next` (else the live file, once
 *     T23 retires `.next`), with `SAM_DISPATCH_LOG` at a temp file;
 *   - `sam-dispatch` always passes `--notify`, so `SAM_JOB_BIN` points at a
 *     shim that drops `--notify` (before `--` only) and execs `sam-job.next`;
 *   - `SAM_JOB_STORE` is this test's temp HOME's `.sam/jobs`, so the job
 *     lands where `readFloorState()` (which reads `$HOME/.sam/jobs`) looks,
 *     and never in the live job store;
 *   - `SAM_JOB_RUN_SH` points at a stub run script that saves the dispatched
 *     `claude -p` line as `cmd.dispatched.sh`, replaces `cmd.sh` with `true`
 *     (after waiting, at most 30 s, for this test to drop a `release` file,
 *     so the floor can be read while the job is running), drops the notify
 *     argument, and then runs the staged `run.next.sh`. The only command a
 *     job ever runs is `true`: no real Claude run, no push (`SAM_PUSH_BIN`
 *     is a stub as well, belt and braces);
 *   - `readScheduledJobs()` gets a runner that allows only read-only
 *     `systemctl --user list-timers`/`show`, filters list-timers down to
 *     this test's unit and returns an empty crontab, so none of Colin's real
 *     timer or cron names reach this test;
 *   - every unit carries a unique `samui-t19-test-<hex>` name; teardown stops
 *     and resets every unit with that name (the timer, its service and the
 *     job's own `sam-job-*` unit) even when the test fails, then asserts none
 *     are left. Transient units have no unit file to disable or remove.
 *
 * BOX-ONLY: the staged tools live under `/home/col`, present only on
 * Colin's box. Without them this reports SKIPPED with its reason, like the
 * other tool tests (see boxOnly.ts). With them, a missing
 * `systemd-run --user` FAILS loudly; it is never skipped.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';

import type { ScheduledJob } from '@/types/floor';

// A fresh HOME before importing anything under test: floorState.ts resolves
// `$HOME/.sam/jobs` at module load.
const tmp = tempDir('sam-schedule-trigger-');
const home = path.join(tmp, 'home');
const store = path.join(home, '.sam', 'jobs');
fs.mkdirSync(store, { recursive: true });
process.env.HOME = home;
process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';

let readFloorState: typeof import('./floorState.js').readFloorState;
let schedule: typeof import('./schedule.js');
let floorRender: typeof import('../../../components/floor/floorRender.js');
let ringRender: typeof import('../../../components/floor/ringRender.js');

function resolveBinary(underTestEnv: string, staged: string, live: string): string {
  const override = process.env[underTestEnv];
  if (override) return override;
  return fs.existsSync(staged) ? staged : live;
}

const DISPATCH_BIN = resolveBinary(
  'SAM_DISPATCH_BIN_UNDER_TEST',
  '/home/col/.local/bin/sam-dispatch.next',
  '/home/col/.local/bin/sam-dispatch',
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

const SKIP = boxOnlySkip('the real sam-dispatch, sam-job and run.sh (or their staged .next copies)', [
  DISPATCH_BIN,
  JOB_BIN,
  RUN_SH,
]);

const LIVE_STORE = '/home/col/.sam/jobs';
const TAG = `samui-t19-test-${crypto.randomBytes(4).toString('hex')}`;
const UNIT = TAG; // systemd-run makes `${UNIT}.timer` and `${UNIT}.service`
const NAME = TAG; // the job's slug, so its own `sam-job-${NAME}-<epoch>` unit carries the tag too
const WAIT_MS = 30_000;

const cwd = path.join(tmp, 'cwd');
const brief = path.join(tmp, 'brief.md');
const dispatchLog = path.join(tmp, 'dispatch.log');
const jobShim = path.join(tmp, 'job-shim');
const shimLog = path.join(tmp, 'job-shim-argv.txt');
const runStub = path.join(tmp, 'run-stub.sh');
const pushBin = path.join(tmp, 'stub-push');
const pushArgv = path.join(tmp, 'push-argv.txt');
const pushSubs = path.join(tmp, 'push-subs.json');
const pushLog = path.join(tmp, 'push-log.jsonl');

let jobDir: string | null = null;
let timersBefore = -1;

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function writeExec(file: string, body: string): void {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function systemctl(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8', timeout: 15_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function timerCount(): number {
  return systemctl(['list-timers', '--all']).stdout.split('\n').length - 1;
}

/** Every loaded unit carrying this run's tag: the timer, its service, the job's own unit. */
function taggedUnits(): string[] {
  return systemctl(['list-units', '--all', '--plain', '--no-legend', `*${TAG}*`])
    .stdout.split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((u) => !!u && u.includes(TAG));
}

/** Idempotent: safe to run from the test's finally and again from after(). */
function cleanup(): void {
  if (jobDir && fs.existsSync(jobDir)) fs.writeFileSync(path.join(jobDir, 'release'), '');
  const units = [...new Set([`${UNIT}.timer`, `${UNIT}.service`, ...taggedUnits()])];
  systemctl(['stop', ...units]);
  systemctl(['reset-failed', ...units]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(what: string, probe: () => T | null): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const v = probe();
    if (v !== null) return v;
    await sleep(200);
  }
  throw new Error(`timed out after ${WAIT_MS / 1000}s waiting for ${what}`);
}

interface Meta {
  id: string;
  status: string;
  exitCode: number | null;
  unit: string;
  notify: boolean;
  general: string | null;
  stages: string[] | null;
  origin: string;
}

function readMeta(dir: string): Meta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as Meta;
  } catch {
    return null; // not written yet, or mid-write
  }
}

before(async () => {
  ({ readFloorState } = await import('./floorState.js'));
  schedule = await import('./schedule.js');
  floorRender = await import('../../../components/floor/floorRender.js');
  ringRender = await import('../../../components/floor/ringRender.js');

  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(
    brief,
    'Task type: sweep\nGeneral: cerberus\nStages: Scan, Report\n\nT19 throwaway test brief. Never run.\n',
  );
  fs.writeFileSync(pushSubs, '[]');
  writeExec(
    pushBin,
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> ${sq(pushArgv)}; done\nexit 0\n`,
  );
  // SAM_JOB_BIN: logs what sam-dispatch passed, drops --notify (options only,
  // never inside the command after --), then execs the staged sam-job.
  writeExec(
    jobShim,
    [
      '#!/bin/bash',
      `printf '%s\\n' "$@" > ${sq(shimLog)}`,
      'args=(); cmd=0',
      'for a in "$@"; do',
      '  if [ "$cmd" = 0 ] && [ "$a" = --notify ]; then continue; fi',
      '  [ "$a" = -- ] && cmd=1',
      '  args+=("$a")',
      'done',
      `exec ${sq(JOB_BIN)} "\${args[@]}"`,
      '',
    ].join('\n'),
  );
  // SAM_JOB_RUN_SH: the dispatched command is kept for the record and never
  // run; cmd.sh becomes `true`, held (30 s at most) until the test releases it.
  writeExec(
    runStub,
    [
      '#!/bin/bash',
      'job_dir="$1"',
      'cp "$job_dir/cmd.sh" "$job_dir/cmd.dispatched.sh"',
      'rel=$(printf %q "$job_dir/release")',
      "printf 'i=0; while [ ! -e %s ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done\\ntrue\\n' \"$rel\" > \"$job_dir/cmd.sh\"",
      `exec /bin/bash ${sq(RUN_SH)} "$job_dir"`,
      '',
    ].join('\n'),
  );
  timersBefore = timerCount();
});

after(() => {
  cleanup();
  const left = taggedUnits();
  console.log(`T19 timers: ${timersBefore} before, ${timerCount()} after; tagged units left: ${left.length}`);
  assert.deepEqual(left, [], `stray ${TAG} units left behind: ${left.join(', ')}`);
});

test(
  "a timer that runs sam-dispatch makes one job: origin 'schedule' on the floor, the trigger on the ring",
  { skip: SKIP, timeout: 4 * WAIT_MS },
  async () => {
    try {
      // Fail loudly, never skip, when the user manager can't take a transient unit.
      const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], { encoding: 'utf8' });
      assert.equal(
        probe.status,
        0,
        `systemd-run --user is unavailable; scheduleTrigger.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
      );

      const env = {
        SAM_ORIGIN: 'schedule',
        SAM_CHAT_ID: '',
        SAM_JOB_STORE: store,
        SAM_JOB_BIN: jobShim,
        SAM_JOB_RUN_SH: runStub,
        SAM_DISPATCH_LOG: dispatchLog,
        SAM_PUSH_BIN: pushBin,
        SAM_PUSH_SUBS: pushSubs,
        SAM_PUSH_LOG: pushLog,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        // A transient unit inherits nothing, and sam-dispatch execs the job so never removes its mktemp copy of the brief.
        TMPDIR: tmp,
      };
      const fired = spawnSync(
        'systemd-run',
        [
          '--user',
          `--unit=${UNIT}`,
          '--description=SAM_ui T19 throwaway test timer',
          '--on-active=1',
          '--timer-property=AccuracySec=100ms',
          // The service stays loaded after its run, so `show` can still read its ExecStart.
          '--property=Type=oneshot',
          '--property=RemainAfterExit=yes',
          ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`),
          DISPATCH_BIN,
          '--tier', 'haiku', '--brief', brief, '--cwd', cwd, '--name', NAME,
        ],
        { encoding: 'utf8', timeout: 15_000 },
      );
      assert.equal(fired.status, 0, `systemd-run could not create the test timer: ${fired.stderr}`);

      // 1. The timer fires, sam-dispatch hands the brief to sam-job, the job runs (held at `true`).
      const dir = await waitFor('the job to appear in the temp store', () => {
        const ids = fs.existsSync(store) ? fs.readdirSync(store).filter((n) => n.startsWith(`job_${NAME}_`)) : [];
        return ids.length > 0 ? path.join(store, ids[0]) : null;
      });
      jobDir = dir;
      const id = path.basename(dir);
      const running = await waitFor('the job to be running', () => {
        const m = readMeta(dir);
        return m && m.status === 'running' ? m : null;
      });
      assert.deepEqual(fs.readdirSync(store), [id], 'exactly one job in the store');
      assert.equal(running.origin, 'schedule');
      assert.equal(running.general, 'cerberus');
      assert.deepEqual(running.stages, ['Scan', 'Report']);
      assert.equal(running.notify, false, 'no --notify reached sam-job');
      assert.ok(running.unit.includes(TAG), `the job's unit carries the tag: ${running.unit}`);

      // 2. The floor: one worker, under Cerberus, from the schedule; nothing under SAM or anyone else.
      const floor = await readFloorState();
      const all = [...floor.samWorkers, ...Object.values(floor.generals).flatMap((g) => g.workers)];
      assert.equal(all.length, 1, `one worker on the whole floor, got ${JSON.stringify(all.map((w) => w.jobId))}`);
      const [worker] = floor.generals.cerberus.workers;
      assert.equal(worker?.jobId, id);
      assert.equal(worker.origin, 'schedule');
      assert.equal(worker.status, 'running');
      assert.deepEqual(worker.stagesPlanned, ['Scan', 'Report']);
      assert.equal(floor.generals.cerberus.idle, false);
      for (const g of ['hermes', 'hephaestus', 'calliope', 'prometheus'] as const) assert.equal(floor.generals[g].idle, true, `${g} idle`);
      assert.ok(floor.dispatchFlares.filter((f) => f.jobId === id).length <= 1, 'Zeus flares at most once for it');

      // 3. The schedule: the test timer (and only it) is seen, and it launches a fleet job.
      const scoped: import('./schedule.js').CommandRunner = async (cmd, args) => {
        if (cmd === 'crontab') return '';
        if (cmd !== 'systemctl' || args[0] !== '--user' || (args[1] !== 'list-timers' && args[1] !== 'show')) {
          throw new Error(`refused in test: ${cmd} ${args.join(' ')}`);
        }
        if (args[1] === 'show') {
          const units = args.slice(2, args.indexOf('-p'));
          assert.ok(units.every((u) => u.startsWith(UNIT)), `show only reads the test unit: ${units.join(' ')}`);
        }
        const out = await schedule.defaultCommandRunner(cmd, args);
        if (args[1] !== 'list-timers') return out;
        return JSON.stringify((JSON.parse(out) as { unit?: string }[]).filter((e) => e.unit === `${UNIT}.timer`));
      };
      const jobs: ScheduledJob[] = await schedule.readScheduledJobs(scoped);
      assert.equal(jobs.length, 1, `exactly the test timer, got ${jobs.map((j) => j.id).join(', ')}`);
      const timer = jobs[0];
      assert.equal(timer.id, `${UNIT}.timer`);
      assert.equal(timer.kind, 'timer');
      assert.equal(timer.launchesFleetJob, true);
      assert.ok(timer.lastRun, 'the timer has fired');

      // 4. The ring: one tick for the timer; as it fires, one trigger light into SAM; no mark for the fleet job.
      const { DESKTOP_OPTIONS, computeLayout } = floorRender;
      const { RING, buildRing, diffSchedule, emptyRingFx, ringGeometry } = ringRender;
      const layout = computeLayout(1150, 666, DESKTOP_OPTIONS);
      const geo = ringGeometry(layout, layout.home, true);
      const seenAt = Date.now();
      const fx = diffSchedule([{ ...timer, lastRun: null, lastResult: 'not recorded' }], jobs, seenAt, emptyRingFx());
      assert.equal(fx.fires[timer.id], seenAt, 'the poll sees the timer fire');
      const ring = buildRing(jobs, geo, { now: seenAt + RING.LAP_MS / 2, fx, variant: 'desktop' });
      // (a one-second monotonic timer reads as hourly-or-faster, so its marks are beads; every one is the timer's own)
      assert.ok(ring.marks.length >= 1 && ring.marks.every((m) => m.jobIds.length === 1 && m.jobIds[0] === timer.id), 'every mark is the timer');
      assert.deepEqual(ring.ticks.map((t) => t.jobId), [timer.id], 'one tick: the timer');
      assert.ok(!JSON.stringify(ring.marks).includes(id) && !JSON.stringify(ring.ticks).includes(id), 'the fleet job is never on the ring');
      assert.equal(ring.triggers.length, 1, 'one trigger light');
      const [trig] = ring.triggers;
      assert.equal(trig.jobId, timer.id);
      assert.deepEqual(trig.curve[3], geo.core, 'the trigger ends at SAM');
      assert.ok(trig.p > 0 && trig.p < 1);
      const settled = buildRing(jobs, geo, { now: seenAt + RING.LAP_MS + 50, fx, variant: 'desktop' });
      assert.equal(settled.triggers.length, 0, 'the trigger is gone once the lap is done');
      const plain = buildRing([{ ...timer, launchesFleetJob: false }], geo, { now: seenAt + RING.LAP_MS / 2, fx, variant: 'desktop' });
      assert.equal(plain.triggers.length, 0, 'a timer that launches no fleet job fires with no trigger light');
      const still = buildRing(jobs, geo, { now: seenAt + RING.LAP_MS / 2, fx, variant: 'desktop', reduced: true });
      assert.equal(still.triggers.length, 0, 'no trigger light under reduced motion');

      // 5. The job ends with `true`: off the floor, one slab on Cerberus's tower, events in order.
      fs.writeFileSync(path.join(dir, 'release'), '');
      const ended = await waitFor('the job to finish', () => {
        const m = readMeta(dir);
        return m && (m.status === 'exited' || m.status === 'failed') ? m : null;
      });
      assert.equal(ended.exitCode, 0);
      const done = await readFloorState();
      assert.equal(done.samWorkers.length + Object.values(done.generals).reduce((n, g) => n + g.workers.length, 0), 0);
      assert.equal(done.towers.cerberus, 1, 'one job, one slab');
      const events = fs
        .readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as { type: string; exitCode?: number });
      assert.equal(events.map((e) => e.type).join(','), 'dispatched,started,ended');
      assert.equal(events[2].exitCode, 0);

      // 6. Nothing real ran or was touched.
      // sam-job stores the command %q-quoted (`claude\ -p\ ...`); read it with the backslashes out
      const dispatched = fs.readFileSync(path.join(dir, 'cmd.dispatched.sh'), 'utf8').replace(/\\/g, '');
      assert.match(dispatched, /claude -p/, 'sam-dispatch built its real claude line');
      assert.match(dispatched, /--model claude-haiku-4-5-20251001/);
      assert.equal(fs.readFileSync(path.join(dir, 'stdout.log'), 'utf8'), '', 'the job ran only `true`');
      const shimArgs = fs.readFileSync(shimLog, 'utf8').split('\n');
      assert.ok(shimArgs.includes('--notify'), 'sam-dispatch asked for --notify (the shim dropped it)');
      assert.ok(!fs.existsSync(pushArgv), 'no push was sent');
      const logLines = fs.readFileSync(dispatchLog, 'utf8').split('\n').filter((l) => l.trim());
      assert.equal(logLines.length, 1);
      assert.ok(logLines[0].includes(`\t${NAME}\thaiku\tsweep\t`), logLines[0]);
      const live = fs.existsSync(LIVE_STORE) ? fs.readdirSync(LIVE_STORE).filter((n) => n.includes(TAG)) : [];
      assert.deepEqual(live, [], 'nothing in the live job store');
    } finally {
      cleanup();
    }
  },
);
