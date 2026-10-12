/**
 * Floor canvas label: a ticket job shows the live "N of M tickets done"
 * (job ticket panel, M15), never the launch summary's numbers. Non-ticket
 * workers keep their old text.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FloorWorker } from '../../types/floor.js';
import { workerLines } from './floorRender.js';

function w(extra: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId: 'job-kitchen', general: 'hephaestus', status: 'running', origin: 'chat', stages: null, stagesPlanned: null,
    elapsedMs: 60_000, costUsd: null, startedAt: '2026-10-09T10:00:00Z', endedAt: null,
    summary: 'Kitchen R4 build (resume, 19 of 24 done)', ...extra,
  };
}
const stages: FloorWorker['stages'] = [{ name: 'grill', state: 'done' }, { name: 'spec', state: 'now' }, { name: 'build', state: 'todo' }];

test('ticket worker line 2 is the live count, not the summary', () => {
  assert.equal(workerLines(w({ tickets: { done: 20, total: 24 } })).line2, '20 of 24 tickets done');
  assert.equal(workerLines(w({ tickets: { done: 20, total: 24 } })).line1, 'Running');
});

test('ticket worker with stages keeps the stage name on line 1', () => {
  const l = workerLines(w({ stages, tickets: { done: 20, total: 24 } }));
  assert.deepEqual(l, { line1: 'Spec', line2: '20 of 24 tickets done' });
});

test('tickets null with stages gives the old Stage n of m', () => {
  assert.deepEqual(workerLines(w({ stages, tickets: null })), { line1: 'Spec', line2: 'Stage 2 of 3' });
});

test('neither tickets nor stages gives Running and the elapsed text', () => {
  assert.deepEqual(workerLines(w()), { line1: 'Running', line2: '1m 00s' });
});

test('failed and queued branches ignore tickets', () => {
  assert.deepEqual(workerLines(w({ status: 'failed', tickets: { done: 1, total: 2 } })), { line1: 'Failed', line2: 'Ended non-zero' });
  assert.deepEqual(workerLines(w({ status: 'queued', tickets: { done: 1, total: 2 } })), { line1: 'Queued', line2: 'Standing by' });
});
