/**
 * Boot reconcile must not file a live headless (sam-job) job as "killed".
 * Such a job has a `unit` and no `pid`; the unit's state is its liveness.
 * Runs under a temp HOME with an injected unit probe, so no systemd is needed.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

type ManagerModule = typeof import('./manager.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-unit-'));
const home = path.join(tmp, 'home');
let manager: ManagerModule;

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  manager = await import('./manager.js');
  // Construct the singleton while the store is empty so its own boot sweep is a no-op.
  manager.getJobManager();
  await new Promise((r) => setTimeout(r, 20));
});

after(() => {
  manager.__setUnitProbeForTests(null);
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeJob(id: string, unit: string | undefined): string {
  const dir = path.join(home, '.sam', 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    id,
    command: 'sleep 1000',
    status: 'running',
    exitCode: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    outputBytes: 0,
    ...(unit ? { unit } : {}),
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return dir;
}

function readMeta(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(home, '.sam', 'jobs', id, 'meta.json'), 'utf-8'));
}

function reconcile(): Promise<void> {
  return (manager.getJobManager() as unknown as { __reconcileForTests(): Promise<void> }).__reconcileForTests();
}

test('(a) a running record whose unit is active is not finalised while it stays active', async () => {
  const id = 'job_live_20261004-000001';
  const dir = writeJob(id, 'sam-job-live-1');
  let active = true;
  manager.__setUnitProbeForTests(async () => (active ? 'active' : 'inactive'), 5);
  const done = reconcile();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(readMeta(id).status, 'running');
  active = false;
  fs.writeFileSync(path.join(dir, 'exitcode'), '0\n');
  await done;
  assert.equal(readMeta(id).status, 'exited');
});

test('(b) unit inactive with exitcode 0: finalised exited, code 0', async () => {
  const id = 'job_done_20261004-000003';
  const dir = writeJob(id, 'sam-job-done-3');
  fs.writeFileSync(path.join(dir, 'exitcode'), '0\n');
  manager.__setUnitProbeForTests(async () => 'inactive');
  await reconcile();
  const meta = readMeta(id);
  assert.equal(meta.status, 'exited');
  assert.equal(meta.exitCode, 0);
  assert.equal(meta.exitSource, 'sentinel');
});

test('(b2) active at boot, inactive later, exitcode 0: finalised exited by the watch', async () => {
  const id = 'job_watch_20261004-000004';
  const dir = writeJob(id, 'sam-job-watch-4');
  let calls = 0;
  manager.__setUnitProbeForTests(async () => {
    if (++calls === 1) return 'active';
    fs.writeFileSync(path.join(dir, 'exitcode'), '0\n');
    return 'inactive';
  }, 5);
  await reconcile();
  const meta = readMeta(id);
  assert.equal(meta.status, 'exited');
  assert.equal(meta.exitCode, 0);
});

test('(c) a record run.sh finalised meanwhile is not overwritten', async () => {
  const id = 'job_race_20261004-000005';
  const dir = writeJob(id, 'sam-job-race-5');
  let calls = 0;
  manager.__setUnitProbeForTests(async () => {
    if (++calls === 1) return 'active';
    // run.sh records its own outcome as the unit winds down.
    const m = readMeta(id);
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({ ...m, status: 'failed', exitCode: 7, endedAt: '2026-10-04T09:00:00.000Z' }),
    );
    fs.writeFileSync(path.join(dir, 'exitcode'), '0\n');
    return 'inactive';
  }, 5);
  await reconcile();
  const meta = readMeta(id);
  assert.equal(meta.status, 'failed');
  assert.equal(meta.exitCode, 7);
  assert.equal(meta.endedAt, '2026-10-04T09:00:00.000Z');
});

test('(d) an invalid unit name never reaches the probe', async () => {
  const bad = ['x; touch pwned', '--user', '-h.service', 'a b.service', 'evil.timer', '$(id).service', 'a/b.service'];
  const seen: string[] = [];
  manager.__setUnitProbeForTests(async (u) => {
    seen.push(u);
    return 'active';
  }, 5);
  bad.forEach((unit, i) => writeJob(`job_bad${i}_20261004-0000${10 + i}`, unit));
  await reconcile();
  assert.deepEqual(seen, []);
  for (let i = 0; i < bad.length; i++) {
    // Unknown unit, no pid, no sentinel: existing behaviour, filed as killed.
    assert.equal(readMeta(`job_bad${i}_20261004-0000${10 + i}`).status, 'killed');
  }
  assert.equal(manager.isSafeUnitName('sam-job-samui-memdiag2-1791114286'), true);
  assert.equal(manager.isSafeUnitName('run-p1-i2.scope'), true);
  assert.equal(manager.isSafeUnitName('foo.service'), true);
});

test('a record with neither pid nor unit keeps today\'s behaviour', async () => {
  const id = 'job_nopid_20261004-000030';
  writeJob(id, undefined);
  let probed = false;
  manager.__setUnitProbeForTests(async () => ((probed = true), 'active'), 5);
  await reconcile();
  assert.equal(probed, false);
  assert.equal(readMeta(id).status, 'killed');
});

test('(e) unknown probes mid-watch never finalise the job', async () => {
  const id = 'job_flaky_20261004-000040';
  const dir = writeJob(id, 'sam-job-flaky-40');
  const seq: Array<'active' | 'unknown' | 'inactive'> = ['active', 'unknown', 'unknown', 'active', 'inactive'];
  let calls = 0;
  const statusAfterUnknowns: unknown[] = [];
  manager.__setUnitProbeForTests(async () => {
    const i = calls++;
    // Look at the record just after each unknown has been answered.
    if (i > 0 && seq[i - 1] === 'unknown') statusAfterUnknowns.push(readMeta(id).status);
    if (seq[i] === 'inactive') fs.writeFileSync(path.join(dir, 'exitcode'), '0\n');
    return seq[i];
  }, 5);
  await reconcile();
  assert.deepEqual(statusAfterUnknowns, ['running', 'running']);
  const meta = readMeta(id);
  assert.equal(meta.status, 'exited');
  assert.equal(meta.exitCode, 0);
});

test('(f) unknown at boot is not killed; only a definite inactive is', async () => {
  const id = 'job_bootunk_20261004-000041';
  writeJob(id, 'sam-job-bootunk-41');
  const seq: Array<'unknown' | 'inactive'> = ['unknown', 'inactive'];
  let calls = 0;
  let statusAtSecondProbe: unknown;
  manager.__setUnitProbeForTests(async () => {
    const i = calls++;
    if (i === 1) statusAtSecondProbe = readMeta(id).status;
    return seq[Math.min(i, 1)];
  }, 5);
  await reconcile();
  assert.equal(statusAtSecondProbe, 'running');
  const meta = readMeta(id);
  assert.equal(meta.status, 'killed');
  assert.equal(meta.exitSource, 'unknown');
});

test('(g) persistent unknown past the cap stops the watch and leaves running', async () => {
  const id = 'job_capped_20261004-000042';
  writeJob(id, 'sam-job-capped-42');
  let calls = 0;
  manager.__setUnitProbeForTests(async () => ((calls++, 'unknown')), 5, 60);
  await reconcile();
  assert.ok(calls > 2, 'kept polling until the cap');
  const meta = readMeta(id);
  assert.equal(meta.status, 'running');
  assert.equal(meta.endedAt, null);
});

test('queryUnitState mapping: only inactive/failed end a unit', () => {
  for (const s of ['active', 'reloading', 'activating', 'deactivating', 'maintenance', 'refreshing']) {
    assert.equal(manager.classifyActiveState(s + '\n').state, 'active', s);
  }
  for (const s of ['inactive', 'failed']) assert.equal(manager.classifyActiveState(s).state, 'inactive', s);
  for (const s of ['', 'weird']) assert.equal(manager.classifyActiveState(s).state, 'unknown', s);
});
