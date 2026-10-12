/**
 * SAM — activeJobs.test: the active-jobs row's live ticket progress line
 * (job-ticket-panel T6, spec must-do 15). No DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

process.env.HOME = tempDir('activejobs-home-');

import type { FloorWorker } from '../../../types/floor.js';
import { activeJobProgress } from './ActiveJobsModule.js';

function worker(extra: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId: 'job_kitchen-r4-implement-t20_20261008-205319', general: 'sam', status: 'running', origin: 'chat',
    stages: null, stagesPlanned: null, elapsedMs: 60_000, costUsd: null, startedAt: null, endedAt: null, ...extra,
  };
}

test('a ticket worker reads the live count, not the launch summary', () => {
  const stages = Array.from({ length: 24 }, (_, i) => ({ name: `T${i + 1}`, state: i < 19 ? ('done' as const) : ('todo' as const) }));
  assert.equal(activeJobProgress(worker({ stages, tickets: { done: 20, total: 24 } })), '20 of 24 tickets done');
});

test('a non-ticket worker has no progress line', () => {
  assert.equal(activeJobProgress(worker()), null);
  assert.equal(activeJobProgress(worker({ tickets: null })), null);
});
