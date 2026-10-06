/**
 * quotaLog — the harvester (`sam-quota-log.py`) records the five-hour reset
 * and runs one harvest at a time (spec U6, check 6).
 *
 * Box-only: it runs the real Python script. The script is resolved as the
 * staged `sam-quota-log.next.py` when present, else the live one; set
 * SAM_QUOTA_LOG_BIN to pin it (T25 pins it to the live path after install).
 * Every run uses a temp HOME, so the real ~/.sam/quota is never written.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';
import { tempDir } from '@/lib/server/testing/tempDir';

function stagedOrLive(staged: string, live: string): string {
  return fs.existsSync(staged) ? staged : live;
}

const QUOTA_BIN =
  process.env.SAM_QUOTA_LOG_BIN ||
  stagedOrLive('/home/col/bin/sam-quota-log.next.py', '/home/col/bin/sam-quota-log.py');

const REAL_JOBS = '/home/col/.sam/jobs';
const SKIP = boxOnlySkip('the real sam-quota-log script', [QUOTA_BIN]);

const FIVE_RESET = 1791202200;
const SEVEN_RESET = 1791237600;

/** One framed event: 4-byte channel, 4-byte big-endian length, JSON body. */
function frame(event: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(event));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(1, 0);
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Reads framed events back out of a stdout.log (independent of the script). */
function readFrames(file: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(file);
  const out: Array<Record<string, unknown>> = [];
  let i = 0;
  while (i + 8 <= raw.length) {
    const n = raw.readUInt32BE(i + 4);
    const body = raw.subarray(i + 8, i + 8 + n);
    i += 8 + n;
    try {
      out.push(JSON.parse(body.toString('utf8')));
    } catch {
      /* a torn frame is skipped, as the script does */
    }
  }
  return out;
}

function addJob(home: string, id: string, stdout: Buffer): void {
  const dir = path.join(home, '.sam', 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      id,
      command: 'sam-agent (x)',
      endedAt: '2026-10-05T12:00:00.000Z',
      status: 'done',
    }),
  );
  fs.writeFileSync(path.join(dir, 'stdout.log'), stdout);
}

function homeWithJob(id: string, stdout: Buffer): string {
  const home = tempDir('quotalog-');
  addJob(home, id, stdout);
  return home;
}

function rows(home: string): Array<Record<string, unknown>> {
  const file = path.join(home, '.sam', 'quota', 'runs.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function runOnce(home: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('python3', [QUOTA_BIN], {
      env: { ...process.env, HOME: home },
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve(code));
  });
}

const SYNTHETIC = Buffer.concat([
  frame({
    type: 'rate_limit_event',
    session_id: 's1',
    rate_limit_info: {
      status: 'allowed',
      unifiedWindows: {
        five_hour: { utilization: 0.12, resetsAt: FIVE_RESET },
        seven_day: { utilization: 0.57, resetsAt: SEVEN_RESET },
      },
    },
  }),
  frame({ type: 'result', session_id: 's1', num_turns: 1, duration_ms: 10, modelUsage: {} }),
]);

test('a harvested row carries the five-hour and weekly reset times', { skip: SKIP }, async () => {
  const home = homeWithJob('job_a', SYNTHETIC);
  assert.equal(await runOnce(home), 0);
  const written = rows(home);
  assert.equal(written.length, 1);
  assert.equal(written[0].fiveHourResetsAt, FIVE_RESET);
  assert.equal(written[0].sevenDayResetsAt, SEVEN_RESET);
});

test('two harvests started together log each job once', { skip: SKIP }, async () => {
  // Many jobs, so the read-seen/append section is long enough for two
  // unlocked harvests to overlap reliably.
  const home = homeWithJob('job_b0', SYNTHETIC);
  const want = ['job_b0'];
  for (let i = 1; i < 300; i++) {
    addJob(home, `job_b${i}`, SYNTHETIC);
    want.push(`job_b${i}`);
  }
  const codes = await Promise.all([runOnce(home), runOnce(home)]);
  assert.deepEqual(codes, [0, 0]);
  const ids = rows(home).map((r) => r.id as string);
  assert.equal(ids.length, want.length, 'no job is logged twice');
  assert.deepEqual([...ids].sort(), [...want].sort());
});

/** Newest ended real job whose log has a rate_limit_event with a five-hour reset. */
function newestRealJob(): { dir: string; resetsAt: number } | null {
  if (!fs.existsSync(REAL_JOBS)) return null;
  const dirs = fs
    .readdirSync(REAL_JOBS)
    .map((d) => path.join(REAL_JOBS, d))
    .filter(
      (d) => fs.existsSync(path.join(d, 'stdout.log')) && fs.existsSync(path.join(d, 'meta.json')),
    )
    .map((d) => ({ d, t: fs.statSync(path.join(d, 'stdout.log')).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { d } of dirs) {
    let meta: { endedAt?: string };
    try {
      meta = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!meta.endedAt) continue;
    let resetsAt: number | null = null;
    for (const e of readFrames(path.join(d, 'stdout.log'))) {
      if (e.type !== 'rate_limit_event') continue;
      const info = e.rate_limit_info as { unifiedWindows?: { five_hour?: { resetsAt?: number } } };
      resetsAt = info?.unifiedWindows?.five_hour?.resetsAt ?? null;
    }
    if (resetsAt !== null) return { dir: d, resetsAt };
  }
  return null;
}

const REAL = SKIP ? null : newestRealJob();

test(
  "a real stream-json run's five-hour reset reaches the row",
  { skip: SKIP || (REAL ? false : 'box-only: no real job with a five-hour rate_limit_event') },
  async () => {
    assert.ok(REAL);
    const id = path.basename(REAL.dir);
    const home = tempDir('quotalog-real-');
    const dest = path.join(home, '.sam', 'jobs', id);
    fs.mkdirSync(dest, { recursive: true });
    // Read-only copy of the two files the harvester reads; the real store is never written.
    for (const f of ['meta.json', 'stdout.log']) {
      fs.copyFileSync(path.join(REAL.dir, f), path.join(dest, f));
    }
    const res = spawnSync('python3', [QUOTA_BIN], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const written = rows(home);
    assert.equal(written.length, 1);
    assert.equal(written[0].fiveHourResetsAt, REAL.resetsAt);
  },
);
