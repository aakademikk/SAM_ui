/**
 * fleetUsage: a fleet job (`sam-dispatch`) records its usage at job end
 * (spec U9, U6, check 22 fleet half, check 6).
 *
 * Box-only: it runs the real sam-dispatch, run.sh and sam-quota-log scripts
 * with a fake `claude` first on PATH, a stub job launcher that runs the real
 * run.sh in the foreground (as `sam-job` does under systemd, minus the unit),
 * and a temp HOME and job store, so no real job, unit or quota file is touched.
 * Scripts resolve as the staged `.next` file when present, else the live one;
 * SAM_DISPATCH_BIN and SAM_QUOTA_LOG_BIN pin them (T25 pins the live paths).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';
import { tempDir } from '@/lib/server/testing/tempDir';

function stagedOrLive(staged: string, live: string): string {
  return fs.existsSync(staged) ? staged : live;
}

const DISPATCH_BIN =
  process.env.SAM_DISPATCH_BIN ||
  stagedOrLive('/home/col/.local/bin/sam-dispatch.next', '/home/col/.local/bin/sam-dispatch');
const QUOTA_BIN =
  process.env.SAM_QUOTA_LOG_BIN ||
  stagedOrLive('/home/col/bin/sam-quota-log.next.py', '/home/col/bin/sam-quota-log.py');
const RUN_SH = process.env.SAM_JOB_RUN_SH || '/home/col/.sam/sam-job/run.sh';
const SKIP = boxOnlySkip('the real sam-dispatch, run.sh and sam-quota-log scripts', [
  DISPATCH_BIN,
  QUOTA_BIN,
  RUN_SH,
]);

/** The canned stream a fake `claude` prints, one JSON event per line. */
function cannedStream(fiveReset: number): string {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'fleet-sess-1' },
    {
      type: 'rate_limit_event',
      session_id: 'fleet-sess-1',
      rate_limit_info: {
        status: 'allowed',
        unifiedWindows: {
          five_hour: { utilization: 0.81, resetsAt: fiveReset },
          seven_day: { utilization: 0.4, resetsAt: fiveReset + 86400 },
        },
      },
    },
    { type: 'assistant', session_id: 'fleet-sess-1', message: { content: [] } },
    {
      type: 'result',
      session_id: 'fleet-sess-1',
      result: 'REPORT TEXT',
      num_turns: 1,
      duration_ms: 10,
      modelUsage: {},
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

// Stands in for sam-job: stages a job dir as sam-job does, then runs the real
// run.sh in the foreground so `ended` is written after the command finishes.
const STUB_JOB = `#!/bin/bash
while [ "$1" != "--" ]; do shift; done; shift
ID="job_t26_$$_$(date +%s%N)"
JD="$SAM_JOB_STORE/$ID"; mkdir -p "$JD"
CMD=""; for a in "$@"; do CMD+=$(printf '%q ' "$a"); done
printf '%s\\n' "$CMD" > "$JD/cmd.sh"
printf '{"id":"%s","command":"fleet:t26 (x)","status":"queued","endedAt":null}' "$ID" > "$JD/meta.json"
SAM_JOB_EVENTS="$JD/events.jsonl" bash "$SAM_JOB_RUN_SH" "$JD" notify
`;

interface Rig {
  home: string;
  jobs: string;
  tmp: string;
  stream: string;
  fiveReset: number;
  env: NodeJS.ProcessEnv;
}

function rig(): Rig {
  const home = tempDir('fleetusage-');
  const bin = path.join(home, 'bin');
  const jobs = path.join(home, '.sam', 'jobs');
  const tmp = path.join(home, 'tmp');
  const cwd = path.join(home, 'cwd');
  for (const d of [bin, jobs, tmp, cwd, path.join(home, '.sam', 'quota')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const fiveReset = Math.floor(Date.now() / 1000) + 2 * 3600;
  const stream = cannedStream(fiveReset);
  fs.writeFileSync(path.join(home, 'stream.jsonl'), stream);
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh\ncat "${path.join(home, 'stream.jsonl')}"\nexit "\${FAKE_CLAUDE_EXIT:-0}"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'stub-job'), STUB_JOB, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'stub-push'), '#!/bin/sh\necho NOTIFY-LINE\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(home, 'brief.md'),
    'Task type: build\nGeneral: sam\nStages: Do\nDo the thing.\n',
  );
  return {
    home,
    jobs,
    tmp,
    stream,
    fiveReset,
    env: {
      ...process.env,
      HOME: home,
      TMPDIR: tmp,
      PATH: `${bin}:${process.env.PATH}`,
      SAM_JOB_BIN: path.join(bin, 'stub-job'),
      SAM_JOB_STORE: jobs,
      SAM_JOB_RUN_SH: RUN_SH,
      SAM_PUSH_BIN: path.join(bin, 'stub-push'),
      SAM_DISPATCH_LOG: path.join(home, 'dispatch.log'),
      SAM_QUOTA_LOG_BIN: QUOTA_BIN,
    },
  };
}

function dispatch(r: Rig, exitCode: number): number | null {
  const res = spawnSync(
    DISPATCH_BIN,
    [
      '--brief',
      path.join(r.home, 'brief.md'),
      '--cwd',
      path.join(r.home, 'cwd'),
      '--name',
      't26',
      '--tier',
      'sonnet',
    ],
    { env: { ...r.env, FAKE_CLAUDE_EXIT: String(exitCode) }, encoding: 'utf8', timeout: 120000 },
  );
  return res.status;
}

function jobDirs(r: Rig): string[] {
  return fs.readdirSync(r.jobs).map((d) => path.join(r.jobs, d));
}

function rows(r: Rig): Array<Record<string, unknown>> {
  const file = path.join(r.home, '.sam', 'quota', 'runs.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test(
  'a fleet job streams to a side file, prints only the report, and records its usage',
  { skip: SKIP },
  () => {
    const r = rig();
    assert.equal(dispatch(r, 0), 0);
    const [jd] = jobDirs(r);
    assert.ok(jd, 'one job dir');

    // (a) stdout.log is the report plus the notify line, no JSON.
    assert.equal(fs.readFileSync(path.join(jd, 'stdout.log'), 'utf8'), 'REPORT TEXT\nNOTIFY-LINE\n');

    // (b) the side file holds the raw stream lines.
    assert.equal(fs.readFileSync(path.join(jd, 'claude-stream.jsonl'), 'utf8'), r.stream);

    // (d) one row for the job, with the five-hour reading and reset, written before `ended`.
    const written = rows(r);
    assert.equal(written.length, 1);
    assert.equal(written[0].id, path.basename(jd));
    assert.equal(written[0].fiveHour, 0.81);
    assert.equal(written[0].fiveHourResetsAt, r.fiveReset);
    const ended = fs
      .readFileSync(path.join(jd, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((e) => e.type === 'ended');
    assert.ok(ended, 'an ended event');
    const endedMs = Date.parse(ended.at);
    assert.ok(
      fs.statSync(path.join(r.home, '.sam', 'quota', 'runs.jsonl')).mtimeMs <= endedMs + 1,
      'the row was written before the ended event',
    );
    assert.ok(Date.parse(written[0].endedAt as string) <= endedMs, 'row endedAt is not after ended');

    // (e) a later hourly-mode harvest adds no duplicate.
    const hourly = spawnSync('python3', [QUOTA_BIN], { env: r.env, encoding: 'utf8' });
    assert.equal(hourly.status, 0, hourly.stderr);
    assert.equal(rows(r).length, 1, 'the hourly run skips the job');

    // (f) the brief's working copy is gone from the temp dir.
    assert.deepEqual(fs.readdirSync(r.tmp), []);
  },
);

test("the dispatch exits with claude's own exit code", { skip: SKIP }, () => {
  // (c) 0 is covered above; 3 must come through the pipe, tee and jq intact.
  const r = rig();
  assert.equal(dispatch(r, 3), 3);
  const [jd] = jobDirs(r);
  assert.equal(fs.readFileSync(path.join(jd, 'exitcode'), 'utf8').trim(), '3');
  assert.equal(rows(r).length, 1, 'a failed job still records its reading');
});

test('a non-JSON line on claude stdout does not kill the job or lose the report', { skip: SKIP }, () => {
  // A CLI warning or stray hook print between events must not break the pipe (review finding 1).
  const r = rig();
  const [first, ...rest] = r.stream.split('\n').filter(Boolean);
  fs.writeFileSync(
    path.join(r.home, 'stream.jsonl'),
    [first, 'Warning: test', ...rest].join('\n') + '\n',
  );
  assert.equal(dispatch(r, 0), 0);
  const [jd] = jobDirs(r);
  assert.equal(fs.readFileSync(path.join(jd, 'stdout.log'), 'utf8'), 'REPORT TEXT\nNOTIFY-LINE\n');
  assert.ok(
    fs.readFileSync(path.join(jd, 'claude-stream.jsonl'), 'utf8').includes('Warning: test'),
    'the stream file holds every line, including the stray one',
  );
  assert.equal(rows(r).length, 1, 'the usage row is still written');
});

test('the hourly harvest reads a job dir that has a stream file', { skip: SKIP }, () => {
  // A finished job whose usage was not harvested at job end (framed-log reader must not be used).
  const r = rig();
  const id = 'job_hourly_1';
  const jd = path.join(r.jobs, id);
  fs.mkdirSync(jd, { recursive: true });
  fs.writeFileSync(
    path.join(jd, 'meta.json'),
    JSON.stringify({
      id,
      command: 'fleet:x (y)',
      endedAt: '2026-10-05T12:00:00.000Z',
      status: 'exited',
    }),
  );
  fs.writeFileSync(path.join(jd, 'stdout.log'), 'REPORT TEXT\n');
  fs.writeFileSync(path.join(jd, 'claude-stream.jsonl'), r.stream);
  const res = spawnSync('python3', [QUOTA_BIN], { env: r.env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const written = rows(r);
  assert.equal(written.length, 1);
  assert.equal(written[0].fiveHourResetsAt, r.fiveReset);
});
