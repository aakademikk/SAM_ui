/**
 * SAM — buildLog.test: build log reader (job ticket panel T9).
 * Scratch HOME; homedir() is read at call time so HOME is set before the call.
 *
 * Spec: must-do 4, 16; check 3.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

import { buildLogPath, readBuildJobs } from './buildLog.js';

function setup() {
  const home = tempDir('buildlog-');
  process.env.HOME = home;
  const wt = join(home, 'wt');
  mkdirSync(join(wt, 'implementation'), { recursive: true });
  const tickets = join(wt, 'implementation', 'demo-tickets.md');
  writeFileSync(tickets, '## T1: A\nStatus: TODO\n');
  mkdirSync(join(home, '.sam', 'jobs'), { recursive: true });
  mkdirSync(join(home, '.sam', 'builds'), { recursive: true });
  return { home, wt, tickets };
}

function makeJob(home: string, id: string, meta: Record<string, unknown>) {
  const dir = join(home, '.sam', 'jobs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
}

const line = (o: Record<string, unknown>) => JSON.stringify(o) + '\n';

test('buildLogPath: stem plus first 8 hex of sha1 of the realpath', () => {
  const { home, tickets } = setup();
  const h8 = createHash('sha1').update(realpathSync(tickets)).digest('hex').slice(0, 8);
  assert.equal(buildLogPath(tickets, home), join(home, '.sam', 'builds', `demo-tickets-${h8}.jsonl`));
});

test('three logged jobs, one folder missing: all three, newest first, missing one from the log', async () => {
  const { home, tickets } = setup();
  const log = [
    line({ kind: 'dispatch', jobId: 'job_a', at: '2026-10-08T10:00:00Z' }),
    line({ kind: 'end', jobId: 'job_a', at: '2026-10-08T11:00:00Z', verdict: 'PASS all good' }),
    line({ kind: 'dispatch', jobId: 'job_b', at: '2026-10-08T12:00:00Z' }),
    'this is not json\n',
    line({ kind: 'end', jobId: 'job_b', at: '2026-10-08T13:00:00Z', verdict: 'FAIL' }),
    line({ kind: 'dispatch', jobId: 'job_c', at: '2026-10-08T14:00:00Z' }),
  ].join('');
  writeFileSync(buildLogPath(tickets, home), log);
  // job_a and job_c have folders; job_b is pruned. Meta wins over the log.
  makeJob(home, 'job_a', { status: 'exited', exitCode: 0, startedAt: '2026-10-08T10:00:05Z', endedAt: '2026-10-08T10:59:00Z' });
  makeJob(home, 'job_c', { status: 'running', startedAt: '2026-10-08T14:00:05Z', endedAt: null });

  const jobs = await readBuildJobs(tickets);
  assert.deepEqual(jobs.map((j) => j.id), ['job_c', 'job_b', 'job_a']);
  assert.deepEqual(jobs[0], { id: 'job_c', state: 'running', startedAt: '2026-10-08T14:00:05Z', endedAt: null, folder: true });
  assert.deepEqual(jobs[1], { id: 'job_b', state: 'failed', startedAt: '2026-10-08T12:00:00Z', endedAt: '2026-10-08T13:00:00Z', folder: false });
  assert.deepEqual(jobs[2], { id: 'job_a', state: 'done', startedAt: '2026-10-08T10:00:05Z', endedAt: '2026-10-08T10:59:00Z', folder: true });
});

test('pruned job with a PASS end line is done; with no end line it is "ended, outcome unknown"', async () => {
  const { home, tickets } = setup();
  writeFileSync(
    buildLogPath(tickets, home),
    line({ kind: 'dispatch', jobId: 'job_p', at: '2026-10-08T10:00:00Z' }) +
      line({ kind: 'end', jobId: 'job_p', at: '2026-10-08T11:00:00Z', verdict: 'PASS' }) +
      line({ kind: 'dispatch', jobId: 'job_q', at: '2026-10-08T12:00:00Z' }),
  );
  const jobs = await readBuildJobs(tickets);
  assert.deepEqual(jobs.map((j) => [j.id, j.state, j.endedAt]), [
    ['job_q', 'ended, outcome unknown', null],
    ['job_p', 'done', '2026-10-08T11:00:00Z'],
  ]);
});

test('missing log file: only jobs found by folder, and only for this tickets file', async () => {
  const { home, wt, tickets } = setup();
  const mine = join(home, 'brief-mine.md');
  writeFileSync(mine, 'Build implementation/demo-tickets.md\n');
  makeJob(home, 'job_mine', { status: 'exited', exitCode: 0, startedAt: '2026-10-08T10:00:00Z', endedAt: '2026-10-08T11:00:00Z', closerCtx: { cwd: wt, task: 'build', brief: mine } });
  makeJob(home, 'job_other', { status: 'exited', exitCode: 0, startedAt: '2026-10-08T10:00:00Z', closerCtx: { cwd: wt, task: 'build' } });
  const jobs = await readBuildJobs(tickets);
  assert.deepEqual(jobs.map((j) => j.id), ['job_mine']);
  assert.equal(jobs[0].state, 'done');
});
