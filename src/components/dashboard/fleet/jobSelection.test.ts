/**
 * SAM — jobSelection.test: which job Job detail shows (floor-fixes T11,
 * Must 13, 16, 19). Queued, running and recently failed jobs are pickable;
 * anything else falls back to the first live job. No DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test.
process.env.HOME = tempDir('jobselect-home-');

import type { FloorState, FloorWorker, GeneralId } from '../../../types/floor.js';
import { pickableJobIds, resolveJobId } from './jobSelection.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');

function worker(jobId: string, general: GeneralId | 'sam', status: FloorWorker['status'], extra: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId, general, status, origin: 'chat', stages: null, stagesPlanned: null, elapsedMs: 60_000, costUsd: null,
    startedAt: null, endedAt: null, ...extra,
  };
}

function floor(parts: Partial<Record<GeneralId, FloorWorker[]>>, sam: FloorWorker[] = []): FloorState {
  const ids: GeneralId[] = ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'];
  const generals = {} as FloorState['generals'];
  for (const id of ids) generals[id] = { idle: !(parts[id]?.length), workers: parts[id] ?? [] };
  return {
    generals, samWorkers: sam,
    towers: { hermes: 0, hephaestus: 0, calliope: 0, cerberus: 0, prometheus: 0 },
    dispatchFlares: [],
  };
}

const secsAgo = (s: number) => new Date(NOW - s * 1000).toISOString();

test('pickable jobs: queued, running and recently failed, Generals in order then SAM', () => {
  const state = floor(
    {
      hermes: [worker('h-run', 'hermes', 'running')],
      calliope: [worker('c-fail', 'calliope', 'failed', { endedAt: secsAgo(10) }), worker('c-queued', 'calliope', 'queued')],
    },
    [worker('s-run', 'sam', 'running')],
  );
  assert.deepEqual(pickableJobIds(state, NOW), ['h-run', 'c-queued', 'c-fail', 's-run']);
});

test('pickable jobs: an old failure, a done job and a null floor are not pickable', () => {
  const state = floor({
    hermes: [worker('old-fail', 'hermes', 'failed', { endedAt: secsAgo(600) }), worker('done', 'hermes', 'done', { endedAt: secsAgo(5) })],
  });
  assert.deepEqual(pickableJobIds(state, NOW), []);
  assert.deepEqual(pickableJobIds(null, NOW), []);
});

test('resolve: the selected job is kept while it is live', () => {
  const state = floor({ hermes: [worker('a', 'hermes', 'running', { elapsedMs: 90_000 })], cerberus: [worker('b', 'cerberus', 'running')] });
  assert.equal(resolveJobId(state, 'b', NOW), 'b');
  assert.equal(resolveJobId(state, null, NOW), 'a', 'nothing selected: the first live job (longest running)');
});

test('resolve: a recently failed job can be shown (Must 19)', () => {
  const state = floor({ hermes: [worker('live', 'hermes', 'running')], calliope: [worker('red', 'calliope', 'failed', { endedAt: secsAgo(20) })] });
  assert.equal(resolveJobId(state, 'red', NOW), 'red');
});

test('resolve: a failed job past the hold window, a done job, or a gone job falls back to the first live job (Must 16)', () => {
  const state = floor({
    hermes: [worker('live', 'hermes', 'running'), worker('old', 'hermes', 'failed', { endedAt: secsAgo(300) }), worker('fin', 'hermes', 'done')],
  });
  assert.equal(resolveJobId(state, 'old', NOW), 'live');
  assert.equal(resolveJobId(state, 'fin', NOW), 'live');
  assert.equal(resolveJobId(state, 'missing', NOW), 'live');
});

test('resolve: no live job and nothing pickable gives null', () => {
  assert.equal(resolveJobId(floor({}), 'x', NOW), null);
  assert.equal(resolveJobId(null, null, NOW), null);
  const onlyFailed = floor({ hermes: [worker('red', 'hermes', 'failed', { endedAt: secsAgo(5) })] });
  assert.equal(resolveJobId(onlyFailed, null, NOW), null, 'a failed job is only shown when picked');
});
