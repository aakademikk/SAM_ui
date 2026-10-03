/**
 * SAM — Demo fixtures test (T20, T20b).
 *
 * Pure functions of a clock, so no temp HOME/job-store seam is needed here
 * (unlike `floorState.test.ts`/`schedule.test.ts`) — every assertion just
 * samples `demoFloorStateAt`/`demoScheduleAt`/`demoFleetSpend`/
 * `demoFleetPersonaJobs` at a chosen `t`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEMO_LOOP_MS,
  demoFleetPersonaJobs,
  demoFleetSpend,
  demoFloorStateAt,
  demoScheduleAt,
} from './demoFixtures.js';

const SEGMENT_MS = DEMO_LOOP_MS / 3;
const BASE_T = Date.UTC(2026, 9, 3, 12, 0, 0);

test('demoFloorStateAt cycles through the three jobs over its loop period', () => {
  const mid = SEGMENT_MS / 2;

  const seg0 = demoFloorStateAt(BASE_T + mid);
  assert.equal(seg0.generals.hephaestus.workers.length, 1, 'hephaestus runs the first segment');
  assert.equal(seg0.generals.cerberus.workers.length, 0);
  assert.equal(seg0.generals.hermes.workers.length, 0);
  assert.equal(seg0.generals.hephaestus.idle, false);

  const seg1 = demoFloorStateAt(BASE_T + SEGMENT_MS + mid);
  assert.equal(seg1.generals.cerberus.workers.length, 1, 'cerberus runs the second segment');
  assert.equal(seg1.generals.hephaestus.workers.length, 0);
  assert.equal(seg1.generals.hermes.workers.length, 0);

  const seg2 = demoFloorStateAt(BASE_T + 2 * SEGMENT_MS + mid);
  assert.equal(seg2.generals.hermes.workers.length, 1, 'hermes runs the third segment');
  assert.equal(seg2.generals.hephaestus.workers.length, 0);
  assert.equal(seg2.generals.cerberus.workers.length, 0);

  // The loop repeats: one full DEMO_LOOP_MS later, the same segment is active again.
  const seg0Again = demoFloorStateAt(BASE_T + DEMO_LOOP_MS + mid);
  assert.equal(seg0Again.generals.hephaestus.workers.length, 1);
});

test('demoFloorStateAt: queued, then running with stages lighting in order, then done with no worker left', () => {
  const queued = demoFloorStateAt(BASE_T + 500); // within the 2s queued window
  const qWorker = queued.generals.hephaestus.workers[0];
  assert.equal(qWorker.status, 'queued');
  assert.ok(qWorker.stages?.every((s) => s.state === 'todo'));
  assert.equal(queued.generals.hephaestus.idle, true, 'queued is not running, so the General reads idle');

  const early = demoFloorStateAt(BASE_T + 3_000);
  const eWorker = early.generals.hephaestus.workers[0];
  assert.equal(eWorker.status, 'running');
  assert.equal(early.generals.hephaestus.idle, false);
  const doneCountEarly = eWorker.stages?.filter((s) => s.state === 'done').length ?? 0;

  const later = demoFloorStateAt(BASE_T + SEGMENT_MS - 10_000);
  const lWorker = later.generals.hephaestus.workers[0];
  const doneCountLater = lWorker.stages?.filter((s) => s.state === 'done').length ?? 0;
  assert.ok(doneCountLater >= doneCountEarly, 'stages light in order as time passes');

  const towersBefore = demoFloorStateAt(BASE_T + 3_000).towers.hephaestus;
  const done = demoFloorStateAt(BASE_T + SEGMENT_MS - 1_000);
  assert.equal(done.generals.hephaestus.workers.length, 0, 'a done job is off the floor (Must 11)');
  assert.equal(done.towers.hephaestus, towersBefore + 1, 'a done job drops exactly one tower slab');
});

test('demoFloorStateAt: the dispatch flare fires only in a short window at the start of the run', () => {
  const beforeDispatch = demoFloorStateAt(BASE_T + 500);
  assert.equal(beforeDispatch.dispatchFlares.length, 0);

  const atDispatch = demoFloorStateAt(BASE_T + 2_500);
  assert.equal(atDispatch.dispatchFlares.length, 1);

  const longAfter = demoFloorStateAt(BASE_T + 10_000);
  assert.equal(longAfter.dispatchFlares.length, 0, 'the flare fires at no other time (Must 9)');
});

test('demoFloorStateAt: a job with no stage events (background flavour) never invents stages (Must 17)', () => {
  const state = demoFloorStateAt(BASE_T);
  const benchmark = state.generals.prometheus.workers.find((w) => w.jobId === 'demo-benchmark');
  assert.ok(benchmark);
  assert.equal(benchmark.stages, null);
  assert.equal(benchmark.stagesPlanned, null);
  assert.equal(benchmark.status, 'running');
});

test('demoScheduleAt exercises every ring-mark shape: bead (frequent), line (hours/daily) and diamond (weekly/weekday)', () => {
  const jobs = demoScheduleAt(BASE_T);
  assert.ok(jobs.some((j) => j.cadence === 'frequent'), 'at least one bead-track job');
  assert.ok(jobs.some((j) => j.cadence === 'hours' || j.cadence === 'daily'), 'at least one outer-dial line job');
  assert.ok(jobs.some((j) => j.cadence === 'weekly' || j.cadence === 'weekday'), 'at least one diamond job');

  const cron = jobs.find((j) => j.kind === 'cron');
  assert.ok(cron);
  assert.equal(cron.lastRun, 'not recorded');
  assert.equal(cron.lastResult, 'not recorded');

  const failed = jobs.find((j) => j.lastResult === 'failed');
  assert.ok(failed, 'at least one job shows a failed last run (red tick)');

  const trigger = jobs.find((j) => j.launchesFleetJob);
  assert.ok(trigger, 'at least one job is marked as launching a fleet job (the CVE scan, Must 27)');
});

test('demoFleetSpend: totals agree with the per-persona sums (Must 15)', () => {
  const spend = demoFleetSpend();
  const summed = Object.values(spend.personas).reduce((sum, e) => sum + e.costUsd, 0);
  assert.ok(Math.abs(spend.totalCostUsd - summed) < 0.005);
  const jobsSummed = Object.values(spend.personas).reduce((sum, e) => sum + e.jobs, 0);
  assert.equal(spend.scannedJobs, jobsSummed);
  for (const id of ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'] as const) {
    assert.ok(spend.personas[id]);
  }
});

test('demoFleetPersonaJobs: the active persona gets a job matching the floor\'s current job id', () => {
  const t = BASE_T + SEGMENT_MS / 2; // hephaestus's segment
  const floor = demoFloorStateAt(t);
  const floorJobId = floor.generals.hephaestus.workers[0].jobId;

  const jobs = demoFleetPersonaJobs('hephaestus', t);
  assert.ok(jobs.some((j) => j.id === floorJobId), 'Job detail\'s cross-reference by id must resolve in demo mode too');

  // A persona not currently active still gets its invented history, never the active job's id.
  const cerberusJobs = demoFleetPersonaJobs('cerberus', t);
  assert.ok(!cerberusJobs.some((j) => j.id === floorJobId));
});
