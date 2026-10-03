/**
 * SAM — SchedulePanel.test: `sortByNextRun`'s ordering (Must 26, check 28:
 * "listing every job in next-run order").
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sortByNextRun } from './SchedulePanel';
import type { ScheduledJob } from '@/types/floor';

function job(partial: Partial<ScheduledJob> & { id: string; name: string }): ScheduledJob {
  return {
    kind: 'timer',
    schedulePlain: 'Daily at 06:00',
    cadence: 'daily',
    lastRun: null,
    lastResult: 'not recorded',
    nextRun: null,
    launchesFleetJob: false,
    ...partial,
  };
}

void test('sorts ascending by next run', () => {
  const jobs = [
    job({ id: 'c', name: 'Vault graph rebuild', nextRun: '2026-10-03T21:00:00Z' }),
    job({ id: 'a', name: 'Keep-warm ping', nextRun: '2026-10-03T06:05:00Z' }),
    job({ id: 'b', name: 'Quota log', nextRun: '2026-10-03T06:18:00Z' }),
  ];
  const sorted = sortByNextRun(jobs).map((j) => j.id);
  assert.deepEqual(sorted, ['a', 'b', 'c']);
});

void test('a job with no next run sorts after every job that has one', () => {
  const jobs = [
    job({ id: 'reboot', name: 'Reboot hook', nextRun: null }),
    job({ id: 'daily', name: 'Morning brief', nextRun: '2026-10-03T07:00:00Z' }),
  ];
  const sorted = sortByNextRun(jobs).map((j) => j.id);
  assert.deepEqual(sorted, ['daily', 'reboot']);
});

void test('two jobs with no next run fall back to name order', () => {
  const jobs = [
    job({ id: 'z', name: 'Zed hook', nextRun: null }),
    job({ id: 'a', name: 'Alpha hook', nextRun: null }),
  ];
  const sorted = sortByNextRun(jobs).map((j) => j.id);
  assert.deepEqual(sorted, ['a', 'z']);
});

void test('an unparseable next run is treated the same as none', () => {
  const jobs = [
    job({ id: 'bad', name: 'Bad timestamp', nextRun: 'not-a-date' }),
    job({ id: 'good', name: 'Good timestamp', nextRun: '2026-10-03T06:00:00Z' }),
  ];
  const sorted = sortByNextRun(jobs).map((j) => j.id);
  assert.deepEqual(sorted, ['good', 'bad']);
});
