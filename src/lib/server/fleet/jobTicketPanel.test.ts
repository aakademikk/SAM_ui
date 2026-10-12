/**
 * SAM — jobTicketPanel.test: panel data assembler (job ticket panel T10).
 * Scratch HOME; the kitchen R4 tickets copy is the fixture.
 *
 * Spec: must-do 2 to 10; checks 1, 4, 7.
 */

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';
import { parseTickets } from './ticketsFile.js';
import { MISSING_NOTICE, readJobTicketPanel } from './jobTicketPanel.js';

const FIXTURES = join(process.cwd(), 'src/lib/server/fleet/fixtures');
const KITCHEN = join(FIXTURES, 'kitchen-v3-phone-flow-tickets.md');

function setup(ticketsText?: string) {
  const home = tempDir('jtp-');
  process.env.HOME = home;
  const wt = join(home, 'wt');
  mkdirSync(join(wt, 'implementation'), { recursive: true });
  const tickets = join(wt, 'implementation', 'kitchen-v3-phone-flow-tickets.md');
  if (ticketsText === undefined) copyFileSync(KITCHEN, tickets);
  else writeFileSync(tickets, ticketsText);
  mkdirSync(join(home, '.sam', 'jobs'), { recursive: true });
  return { home, wt, tickets };
}

function makeJob(home: string, id: string, meta: Record<string, unknown>, brief?: string, stream?: string) {
  const dir = join(home, '.sam', 'jobs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  if (brief !== undefined) writeFileSync(join(dir, 'brief.md'), brief);
  if (stream !== undefined) writeFileSync(join(dir, 'claude-stream.jsonl'), stream);
  return dir;
}

const BRIEF = 'Build the tickets in implementation/kitchen-v3-phone-flow-tickets.md please.';
const ctx = (wt: string, task = 'build') => ({ closerCtx: { cwd: wt, task } });

test('kitchen R4: 24 tickets in order, heading matches the DONE count of the copy', async () => {
  const { home, wt } = setup();
  const id = 'job_kitchen-r4-implement-t20_20261008-205319';
  makeJob(home, id, { status: 'exited', exitCode: 0, ...ctx(wt) }, BRIEF);
  const expected = parseTickets(readFileSync(KITCHEN, 'utf8')).tickets;
  const doneCount = expected.filter((t) => t.label.toLowerCase() === 'done').length;

  const p = await readJobTicketPanel(id);
  assert.equal(p.mode, 'tickets');
  if (p.mode !== 'tickets') return;
  assert.equal(p.tickets.length, 24);
  assert.deepEqual(p.tickets.map((t) => t.n), expected.map((t) => t.n));
  assert.equal(p.heading, `${doneCount} of 24 tickets done`);
});

test('IN PROGRESS claimed by a running job is running, not stalled', async () => {
  const { home, wt } = setup('## T1: A\nStatus: IN PROGRESS job_worker\n\n## T2: B\nStatus: DONE\n');
  makeJob(home, 'job_worker', { status: 'running' });
  makeJob(home, 'job_main', ctx(wt), BRIEF);
  const p = await readJobTicketPanel('job_main');
  assert.equal(p.mode, 'tickets');
  if (p.mode !== 'tickets') return;
  assert.deepEqual(p.tickets[0].claim, { jobId: 'job_worker', running: true, stalled: false });
  assert.equal(p.tickets[1].claim, null);
  assert.equal(p.heading, '1 of 2 tickets done');
});

test('IN PROGRESS claimed by an ended job, or one with no folder, is stalled', async () => {
  const { home, wt } = setup('## T1: A\nStatus: IN PROGRESS job_ended\n\n## T2: B\nStatus: IN PROGRESS job_gone\n');
  makeJob(home, 'job_ended', { status: 'exited', exitCode: 0 });
  makeJob(home, 'job_main', ctx(wt), BRIEF);
  const p = await readJobTicketPanel('job_main');
  assert.equal(p.mode, 'tickets');
  if (p.mode !== 'tickets') return;
  assert.deepEqual(p.tickets[0].claim, { jobId: 'job_ended', running: false, stalled: true });
  assert.deepEqual(p.tickets[1].claim, { jobId: 'job_gone', running: false, stalled: true });
});

test('running job: last activity skips heartbeats, failed runs listed; ended long ago: no last activity, failed runs still listed', async () => {
  const { home, wt } = setup();
  const stream =
    [
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-09T08:00:00Z', message: { content: [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'npm test' } }] } }),
      JSON.stringify({ type: 'user', timestamp: '2026-10-09T08:01:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'Exit code 143\nkilled' }] } }),
      JSON.stringify({ type: 'tool_progress', heartbeat: true, timestamp: '2026-10-09T08:30:00Z' }),
    ].join('\n') + '\n';
  makeJob(home, 'job_run', { status: 'running', ...ctx(wt) }, BRIEF, stream);
  makeJob(home, 'job_old', { status: 'exited', endedAt: '2020-01-01T00:00:00Z', ...ctx(wt) }, BRIEF, stream);

  const p = await readJobTicketPanel('job_run');
  assert.equal(p.mode, 'tickets');
  if (p.mode !== 'tickets') return;
  assert.equal(p.lastActivity, '2026-10-09T08:01:00Z');
  assert.equal(p.failedRuns.count, 1);
  assert.equal(p.failedRuns.recent[0].timedOut, true);

  const o = await readJobTicketPanel('job_old');
  assert.equal(o.mode, 'tickets');
  if (o.mode !== 'tickets') return;
  assert.equal(o.lastActivity, null);
  assert.equal(o.failedRuns.count, 1);
  assert.equal(o.failedRuns.recent[0].timedOut, true);
});

test('no tickets file named: stages mode, no notice', async () => {
  const { home, wt } = setup();
  makeJob(home, 'job_plain', ctx(wt), 'Just do some work.');
  assert.deepEqual(await readJobTicketPanel('job_plain'), { mode: 'stages' });
});

test('tickets file missing: stages mode with the one-line notice', async () => {
  const { home, wt } = setup();
  makeJob(home, 'job_nowt', ctx(wt), 'Build implementation/other-tickets.md now.');
  const p = await readJobTicketPanel('job_nowt');
  assert.deepEqual(p, { mode: 'stages', notice: MISSING_NOTICE });
  assert.ok(!MISSING_NOTICE.includes('\n'));
});

test('bad job ids return stages and read nothing outside the root', async () => {
  const { home, wt } = setup();
  // A decoy outside the jobs root that would resolve as a ticket job if reached.
  const decoy = join(home, '.sam', 'x');
  mkdirSync(decoy, { recursive: true });
  writeFileSync(join(decoy, 'meta.json'), JSON.stringify(ctx(wt)));
  writeFileSync(join(decoy, 'brief.md'), BRIEF);
  for (const bad of ['../x', 'job_..', 'job_../x', '', 'x', 'job_a/b']) {
    assert.deepEqual(await readJobTicketPanel(bad), { mode: 'stages' }, bad);
  }
});
