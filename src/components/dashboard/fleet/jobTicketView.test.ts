/**
 * SAM — jobTicketView.test: pure panel formatter (job ticket panel, T12).
 * Spec checks 2, 4, 5, 6.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseTickets, ticketProgress } from '../../../lib/server/fleet/ticketsFile.js';
import { formatTicketPanel, shortTime, type TicketsData } from './jobTicketView.js';

const WORDS = join(process.cwd(), 'src/lib/server/fleet/fixtures/status-words-tickets.md');
const NOW = Date.parse('2026-10-09T10:00:00Z');

function data(over: Partial<TicketsData> = {}, stalled = false): TicketsData {
  const { tickets } = parseTickets(readFileSync(WORDS, 'utf8'));
  const { done, total } = ticketProgress(tickets);
  return {
    mode: 'tickets',
    ticketsPath: '/x/implementation/a-tickets.md',
    tickets: tickets.map((t) => ({
      ...t,
      claim: t.label === 'IN PROGRESS' && t.claimJobId ? { jobId: t.claimJobId, running: !stalled, stalled } : null,
    })),
    done,
    total,
    heading: '',
    jobs: [],
    lastActivity: null,
    failedRuns: { count: 0, recent: [] },
    ...over,
  };
}

test('every status word of the fixture renders as written; heading counts DONE only', () => {
  const v = formatTicketPanel(data(), NOW, 'Kitchen build');
  assert.deepEqual(
    v.tickets.map((t) => t.label),
    ['DONE', 'TODO', 'GATE', 'IN PROGRESS', 'BLOCKED', 'SKIPPED', 'SUPERSEDED', 'PARTLY DONE', 'WOBBLY', 'no status'],
  );
  assert.deepEqual(v.tickets.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(v.heading, '1 of 10 tickets done');
  assert.equal(v.name, 'Kitchen build');
});

test('IN PROGRESS: running shows the job id; stalled shows "stalled: job ended"', () => {
  const run = formatTicketPanel(data(), NOW).tickets[3];
  assert.equal(run.claim, 'job_x_20261008-000000');
  assert.equal(run.stalled, false);
  const dead = formatTicketPanel(data({}, true), NOW).tickets[3];
  assert.equal(dead.claim, 'stalled: job ended');
  assert.equal(dead.stalled, true);
  assert.ok(!JSON.stringify(dead).includes('job_x_'));
  assert.equal(formatTicketPanel(data(), NOW).tickets[0].claim, null);
});

test('failed runs: 143 and 124 are timed out, 1 is exit 1, command trimmed', () => {
  const long = 'npm   test ' + 'x'.repeat(200);
  const v = formatTicketPanel(
    data({
      failedRuns: {
        count: 3,
        recent: [
          { command: '  npm test  ', exitCode: 143, timedOut: true, at: null },
          { command: 'tsc', exitCode: 124, timedOut: true, at: null },
          { command: long, exitCode: 1, timedOut: false, at: null },
        ],
      },
    }),
    NOW,
  );
  assert.deepEqual(v.failedRuns.map((r) => r.outcome), ['timed out', 'timed out', 'exit 1']);
  assert.equal(v.failedRuns[0].command, 'npm test');
  assert.ok(v.failedRuns[2].command.length <= 80);
  assert.ok(v.failedRuns[2].command.startsWith('npm test x'));
  assert.equal(v.failedHeading, '3 failed or timed-out test and build runs');
});

test('last activity: null renders no line; a stamp renders "last activity 5 min ago"', () => {
  assert.equal(formatTicketPanel(data({ lastActivity: null }), NOW).lastActivity, null);
  const at = new Date(NOW - 5 * 60_000).toISOString();
  assert.equal(formatTicketPanel(data({ lastActivity: at }), NOW).lastActivity, 'last activity 5 min ago');
  assert.equal(formatTicketPanel(data({ lastActivity: 'garbage' }), NOW).lastActivity, null);
});

test('build job rows: id, state as given, short local start and end', () => {
  const s = '2026-10-09T08:05:00Z';
  const d = new Date(s);
  const exp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const v = formatTicketPanel(
    data({
      jobs: [
        { id: 'job_a', state: 'done', startedAt: s, endedAt: s, folder: true },
        { id: 'job_b', state: 'ended, outcome unknown', startedAt: null, endedAt: null, folder: false },
      ],
    }),
    NOW,
  );
  assert.deepEqual(v.jobs[0], { id: 'job_a', state: 'done', start: exp, end: exp });
  assert.deepEqual(v.jobs[1], { id: 'job_b', state: 'ended, outcome unknown', start: null, end: null });
  assert.equal(shortTime('nope'), null);
});
