/**
 * SAM — floorState.test: `readFloorState` must read both `meta.json` shapes,
 * the legacy `fleet:<persona>` command convention, and real `events.jsonl`
 * stage events — and must never invent a stage a job never reported (Must
 * 17).
 *
 * Checks 6, 8, 11 (spec); Must 7, 8, 10, 13, 17.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Route every ~/.sam path this test touches into a scratch HOME, set BEFORE
// the module under test is imported — JOBS_ROOT in floorState.ts is computed
// from os.homedir() at module load time, same seam as
// src/lib/server/jobs/manager.ts and its own tests. The import is dynamic so
// process.env.HOME is guaranteed to land first; every test below awaits
// `ready` before calling readFloorState().
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'floorstate-home-'));
process.env.HOME = tmpHome;

let readFloorState: typeof import('./floorState.js').readFloorState;
const ready = (async () => {
  ({ readFloorState } = await import('./floorState.js'));
})();

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');

function jobDir(id: string): string {
  const dir = path.join(JOBS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMeta(id: string, meta: Record<string, unknown>): void {
  fs.writeFileSync(path.join(jobDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
}

function writeEvents(id: string, lines: Record<string, unknown>[]): void {
  const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  fs.writeFileSync(path.join(jobDir(id), 'events.jsonl'), text, 'utf-8');
}

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

test('readFloorState builds the floor honestly from fixture job directories', async () => {
  await ready;

  // --- Job A: sam-job-shaped, full events.jsonl, stages light in event
  // order (Must 8). General comes from the `general` field (Must 16a).
  // Its own `dispatched` event is well outside the flare window so it must
  // not show up as a flare.
  writeMeta('job-full-events', {
    id: 'job-full-events',
    command: 'claude -p "plan, build, verify"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-3_600_000),
    startedAt: iso(-3_599_000),
    endedAt: null,
    outputBytes: 0,
    unit: 'sam-job-x',
    notify: false,
    summary: null,
    general: 'hephaestus',
  });
  writeEvents('job-full-events', [
    { type: 'dispatched', at: iso(-3_600_000), stages: ['plan', 'build', 'verify'] },
    { type: 'started', at: iso(-3_599_000) },
    { type: 'stage-start', stage: 'plan', at: iso(-3_598_000) },
    { type: 'stage-done', stage: 'plan', at: iso(-3_500_000) },
    { type: 'stage-start', stage: 'build', at: iso(-3_400_000) },
  ]);

  // --- Job B: sam-job-shaped, no General and no events — must show under
  // `sam`, with no stages at all (Must 17).
  writeMeta('job-no-general', {
    id: 'job-no-general',
    command: 'claude -p "tidy the vault"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-100_000),
    startedAt: iso(-90_000),
    endedAt: null,
    outputBytes: 0,
    unit: 'sam-job-y',
    notify: false,
    summary: null,
  });

  // --- Job C: JobManager-shaped (lastSeq, no unit), command carries the
  // legacy `fleet:<persona> (<model>) — ...` convention, no events.jsonl —
  // shows under Cerberus with no stages.
  writeMeta('job-legacy-command', {
    id: 'job-legacy-command',
    command: 'fleet:cerberus (sonnet) — audit the edge router',
    status: 'running',
    exitCode: null,
    createdAt: iso(-50_000),
    startedAt: iso(-40_000),
    endedAt: null,
    outputBytes: 0,
    lastSeq: 3,
  });

  // --- Jobs D1/D2: two running jobs under the same General — two separate
  // FloorWorkers (Must 7).
  writeMeta('job-hermes-1', {
    id: 'job-hermes-1',
    command: 'claude -p "outreach batch 1"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    general: 'hermes',
  });
  writeMeta('job-hermes-2', {
    id: 'job-hermes-2',
    command: 'claude -p "outreach batch 2"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    general: 'hermes',
  });

  // --- Job E: ended non-zero — status 'failed', no tower slab.
  writeMeta('job-calliope-failed', {
    id: 'job-calliope-failed',
    command: 'claude -p "ad copy batch"',
    status: 'exited',
    exitCode: 1,
    createdAt: iso(-200_000),
    startedAt: iso(-190_000),
    endedAt: iso(-180_000),
    general: 'calliope',
  });

  // --- Jobs F1/F2: two jobs verified today under one General — tower
  // count 2, and finished jobs no longer sit on the floor as workers.
  writeMeta('job-prometheus-done-1', {
    id: 'job-prometheus-done-1',
    command: 'claude -p "benchmark run 1"',
    status: 'exited',
    exitCode: 0,
    createdAt: iso(-400_000),
    startedAt: iso(-390_000),
    endedAt: iso(-380_000),
    general: 'prometheus',
  });
  writeMeta('job-prometheus-done-2', {
    id: 'job-prometheus-done-2',
    command: 'claude -p "benchmark run 2"',
    status: 'exited',
    exitCode: 0,
    createdAt: iso(-300_000),
    startedAt: iso(-290_000),
    endedAt: iso(-280_000),
    general: 'prometheus',
  });

  // --- Jobs G/H: dispatch-flare timing (Must 9). Both are SAM-grouped (no
  // General, no fleet: command) and only carry a `dispatched` event.
  writeMeta('job-flare-recent', {
    id: 'job-flare-recent',
    command: 'claude -p "just dispatched"',
    status: 'queued',
    exitCode: null,
    createdAt: iso(-2_000),
    startedAt: null,
    endedAt: null,
  });
  writeEvents('job-flare-recent', [{ type: 'dispatched', at: iso(-2_000) }]);

  writeMeta('job-flare-old', {
    id: 'job-flare-old',
    command: 'claude -p "dispatched a while ago"',
    status: 'queued',
    exitCode: null,
    createdAt: iso(-3_600_000),
    startedAt: null,
    endedAt: null,
  });
  writeEvents('job-flare-old', [{ type: 'dispatched', at: iso(-3_600_000) }]);

  const state = await readFloorState();

  // Job A: stages light in event order, none invented ahead of their event.
  const workerA = state.generals.hephaestus.workers.find((w) => w.jobId === 'job-full-events');
  assert.ok(workerA, 'job-full-events should appear under hephaestus');
  assert.equal(workerA?.status, 'running');
  assert.deepEqual(workerA?.stagesPlanned, ['plan', 'build', 'verify']);
  assert.deepEqual(workerA?.stages, [
    { name: 'plan', state: 'done' },
    { name: 'build', state: 'now' },
    { name: 'verify', state: 'todo' },
  ]);
  assert.equal(state.generals.hephaestus.idle, false);

  // Job B: no General, no events — under sam, no stages invented.
  const workerB = state.samWorkers.find((w) => w.jobId === 'job-no-general');
  assert.ok(workerB, 'job-no-general should appear under sam');
  assert.equal(workerB?.stages, null);
  assert.equal(workerB?.stagesPlanned, null);
  assert.equal(workerB?.status, 'running');

  // Job C: legacy `fleet:cerberus (...)` command, no events — under
  // Cerberus, no stages.
  const workerC = state.generals.cerberus.workers.find((w) => w.jobId === 'job-legacy-command');
  assert.ok(workerC, 'job-legacy-command should appear under cerberus');
  assert.equal(workerC?.stages, null);
  assert.equal(workerC?.stagesPlanned, null);
  assert.equal(state.generals.cerberus.idle, false);

  // Jobs D1/D2: two separate FloorWorkers under the same General.
  assert.equal(state.generals.hermes.workers.length, 2);
  assert.equal(state.generals.hermes.idle, false);
  const hermesIds = state.generals.hermes.workers.map((w) => w.jobId).sort();
  assert.deepEqual(hermesIds, ['job-hermes-1', 'job-hermes-2']);

  // Job E: failed, stays visible (status red), no tower slab, and a failed
  // worker does not count as "running" for idle.
  const workerE = state.generals.calliope.workers.find((w) => w.jobId === 'job-calliope-failed');
  assert.ok(workerE, 'a failed job should still show on the floor');
  assert.equal(workerE?.status, 'failed');
  assert.equal(state.towers.calliope, 0);
  assert.equal(state.generals.calliope.idle, true);

  // Jobs F1/F2: tower count 2, and done jobs no longer sit as workers.
  assert.equal(state.towers.prometheus, 2);
  assert.equal(state.generals.prometheus.workers.length, 0);
  assert.equal(state.generals.prometheus.idle, true);

  // hephaestus carries only job A, and a running job adds no tower slab.
  assert.equal(state.generals.hephaestus.workers.length, 1);
  assert.equal(state.towers.hephaestus, 0);

  // Dispatch flares: only the job dispatched in roughly the last few
  // seconds shows, never the old one (Must 9).
  const flareIds = state.dispatchFlares.map((f) => f.jobId);
  assert.ok(flareIds.includes('job-flare-recent'));
  assert.ok(!flareIds.includes('job-flare-old'));
  assert.ok(!flareIds.includes('job-full-events'), 'an hour-old dispatch must not flare');

  // No cost is invented: none of these fixtures have a stdout.log with a
  // `result` event, so cost is honestly null throughout.
  for (const general of Object.values(state.generals)) {
    for (const worker of general.workers) assert.equal(worker.costUsd, null);
  }
  for (const worker of state.samWorkers) assert.equal(worker.costUsd, null);
});
