/**
 * SAM — stageEvents.test: `diffStageEvents`'s pure transition diff (T10).
 *
 * Not in the ticket's `Files` list — added per the foreman's note ("put the
 * pure aggregation and transition-diff functions where they can be tested
 * headlessly... report it as a deviation if it is a new file not in
 * Files"). `StageEventsModule`'s log is only honest if `diffStageEvents`
 * truly reports just what changed between two polls, never a backfilled or
 * invented timeline (Must 8) — this is worth its own direct test rather
 * than relying on the component mounting.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';

// House rule: a fresh HOME before importing anything under test (this module reads no files, but the rule is cheap).
process.env.HOME = fs.mkdtempSync(`${os.tmpdir()}/stageevents-home-`);

import { diffStageEvents } from './StageEventsModule.js';
import type { FloorState, FloorWorker } from '@/types/floor.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function worker(jobId: string, status: FloorWorker['status'], extra: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId,
    general: 'hephaestus',
    status,
    origin: 'chat',
    stages: null,
    stagesPlanned: null,
    elapsedMs: 0,
    costUsd: null,
    startedAt: iso(60_000),
    endedAt: null,
    ...extra,
  };
}

function emptyFloor(): FloorState {
  return {
    generals: {
      hermes: { idle: true, workers: [] },
      hephaestus: { idle: true, workers: [] },
      calliope: { idle: true, workers: [] },
      cerberus: { idle: true, workers: [] },
      prometheus: { idle: true, workers: [] },
    },
    samWorkers: [],
    towers: { hermes: 0, hephaestus: 0, calliope: 0, cerberus: 0, prometheus: 0 },
    dispatchFlares: [],
  };
}

test('diffStageEvents: the first poll (prev null) logs nothing, even with jobs already present', () => {
  const next = emptyFloor();
  next.generals.hephaestus.workers.push(worker('job-1', 'running'));
  assert.deepEqual(diffStageEvents(null, next, NOW), []);
});

test('diffStageEvents: a job appearing this poll logs only its current status, no backfilled stages', () => {
  const prev = emptyFloor();
  const next = emptyFloor();
  next.generals.hephaestus.workers.push(
    worker('job-new', 'running', {
      stagesPlanned: ['plan', 'build'],
      stages: [{ name: 'plan', state: 'done' }, { name: 'build', state: 'now' }],
    }),
  );

  const events = diffStageEvents(prev, next, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'running');
  assert.equal(events[0].jobId, 'job-new');
  assert.equal(events[0].general, 'hephaestus');
});

test('diffStageEvents: a status change between polls logs exactly one transition', () => {
  const prev = emptyFloor();
  prev.generals.hephaestus.workers.push(worker('job-1', 'queued'));
  const next = emptyFloor();
  next.generals.hephaestus.workers.push(worker('job-1', 'running'));

  const events = diffStageEvents(prev, next, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'running');
  assert.equal(events[0].id, 'job-1:running:');
});

test('diffStageEvents: a stage moving todo -> now -> done logs one entry per move, in order observed', () => {
  const prev = emptyFloor();
  prev.generals.hephaestus.workers.push(
    worker('job-1', 'running', {
      stagesPlanned: ['plan', 'build'],
      stages: [{ name: 'plan', state: 'now' }, { name: 'build', state: 'todo' }],
    }),
  );
  const mid = emptyFloor();
  mid.generals.hephaestus.workers.push(
    worker('job-1', 'running', {
      stagesPlanned: ['plan', 'build'],
      stages: [{ name: 'plan', state: 'done' }, { name: 'build', state: 'now' }],
    }),
  );

  const events = diffStageEvents(prev, mid, NOW);
  assert.equal(events.length, 2);
  const plan = events.find((e) => e.stage === 'plan')!;
  const build = events.find((e) => e.stage === 'build')!;
  assert.equal(plan.kind, 'stage-done');
  assert.equal(build.kind, 'stage-start');
});

test('diffStageEvents: no change between two identical polls logs nothing', () => {
  const state = emptyFloor();
  state.generals.hephaestus.workers.push(
    worker('job-1', 'running', {
      stagesPlanned: ['plan'],
      stages: [{ name: 'plan', state: 'now' }],
    }),
  );
  const copy: FloorState = JSON.parse(JSON.stringify(state));
  assert.deepEqual(diffStageEvents(state, copy, NOW), []);
});

test('diffStageEvents: a job live in prev and vanished in next logs one "done" entry (Must 11)', () => {
  const prev = emptyFloor();
  prev.generals.hephaestus.workers.push(worker('job-1', 'running'));
  const next = emptyFloor(); // job-1 reached done and dropped off the floor

  const events = diffStageEvents(prev, next, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'done');
  assert.equal(events[0].jobId, 'job-1');
});

test('diffStageEvents: a job that vanished while only ever queued (never started) still logs "done", honestly from the same rule', () => {
  const prev = emptyFloor();
  prev.generals.calliope.workers.push(worker('job-q', 'queued', { general: 'calliope' }));
  const next = emptyFloor();

  const events = diffStageEvents(prev, next, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'done');
  assert.equal(events[0].general, 'calliope');
});

test('diffStageEvents: a job already failed in prev and still failed in next logs nothing further', () => {
  const prev = emptyFloor();
  prev.generals.cerberus.workers.push(worker('job-f', 'failed', { general: 'cerberus' }));
  const next = emptyFloor();
  next.generals.cerberus.workers.push(worker('job-f', 'failed', { general: 'cerberus' }));

  assert.deepEqual(diffStageEvents(prev, next, NOW), []);
});

test('diffStageEvents: SAM-owned jobs are logged under "sam"', () => {
  const prev = emptyFloor();
  prev.samWorkers.push(worker('job-sam', 'queued', { general: 'sam' }));
  const next = emptyFloor();
  next.samWorkers.push(worker('job-sam', 'running', { general: 'sam' }));

  const events = diffStageEvents(prev, next, NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].general, 'sam');
  assert.equal(events[0].kind, 'running');
});
