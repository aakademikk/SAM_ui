/**
 * SAM — ticketsFile.test: the one tickets-file parser (job ticket panel T2).
 * Fixtures are copies under ./fixtures; the kitchen file is a copy of
 * kitchen-v3-phone-flow-tickets.md, so counts are made against the copy.
 *
 * Spec: must-do 2, 3, 5; check 1, 2.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseTickets, readTicketsFile, ticketProgress } from './ticketsFile.js';

// Tests run from .test-build, so find the sources from the repo root.
const FIXTURES = join(process.cwd(), 'src/lib/server/fleet/fixtures');
const KITCHEN = join(FIXTURES, 'kitchen-v3-phone-flow-tickets.md');
const WORDS = join(FIXTURES, 'status-words-tickets.md');

test('kitchen copy: 24 tickets in order, labels match the file, progress matches a grep count', async () => {
  const text = readFileSync(KITCHEN, 'utf8');
  const { tickets } = parseTickets(text);
  const headings = text.split('\n').filter((l) => /^## T\d+/.test(l));
  assert.equal(tickets.length, 24);
  assert.equal(tickets.length, headings.length);
  assert.deepEqual(tickets.map((t) => t.n), headings.map((l) => Number(/^## T(\d+)/.exec(l)![1])));
  assert.equal(tickets[0].title, 'Build tooling into the cache');

  const statusLines = text.split('\n').filter((l) => /^Status:/.test(l));
  assert.equal(statusLines.length, 24);
  tickets.forEach((t, i) => {
    const raw = statusLines[i].replace(/^Status:\s*/, '');
    assert.ok(raw.startsWith(t.label), `T${t.n}: "${raw}" starts with label "${t.label}"`);
    assert.equal(`${t.label} ${t.note}`.trim().replace(/\s+/g, ' '), raw.trim().replace(/\s+/g, ' '));
  });

  const greppedDone = statusLines.filter((l) => /^Status:\s*DONE\b/i.test(l)).length;
  assert.deepEqual(ticketProgress(tickets), { done: greppedDone, total: 24 });
  assert.ok(greppedDone >= 1);
  assert.match(tickets[2].files ?? '', /^src\/config\.ts \(edit\)/);

  // The reader gives the same answer as the pure parser.
  assert.deepEqual(await readTicketsFile(KITCHEN), tickets);
});

test('status words fixture: every word shows as written, including WOBBLY', () => {
  const { tickets } = parseTickets(readFileSync(WORDS, 'utf8'));
  assert.deepEqual(
    tickets.map((t) => t.label),
    ['DONE', 'TODO', 'GATE', 'IN PROGRESS', 'BLOCKED', 'SKIPPED', 'SUPERSEDED', 'PARTLY DONE', 'WOBBLY', 'no status'],
  );
  assert.deepEqual(tickets.map((t) => t.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(tickets[0].note, '2026-10-08 (proof passed)');
  assert.equal(tickets[1].note, '');
  assert.equal(tickets[8].note, 'could be anything');
  assert.equal(tickets[7].note, 'the parser landed, the reader did not');
  // "Done" counts DONE only: PARTLY DONE and the trailing non-ticket section do not.
  assert.deepEqual(ticketProgress(tickets), { done: 1, total: 10 });
});

test('IN PROGRESS gives the claiming job id; other labels give none', () => {
  const { tickets } = parseTickets(readFileSync(WORDS, 'utf8'));
  assert.equal(tickets[3].claimJobId, 'job_x_20261008-000000');
  assert.equal(tickets.filter((t) => t.claimJobId !== null).length, 1);
});

test('a ticket with no Status line gets "no status", and Files is kept', () => {
  const { tickets } = parseTickets(readFileSync(WORDS, 'utf8'));
  assert.equal(tickets[9].label, 'no status');
  assert.equal(tickets[9].note, '');
  assert.equal(tickets[9].files, 'src/d.ts');
  assert.equal(tickets[2].files, null);
});

test('grammar edges: case-insensitive prefix, empty status, heading forms, no "DONEZO"', () => {
  const { tickets } = parseTickets(
    ['## T1. dot form', 'Status: done lower', '## T2 no colon', 'Status:', '## T3: x', 'Status: DONEZO', '## T4: y', 'Status: in progress job_a'].join('\n'),
  );
  assert.deepEqual(tickets.map((t) => [t.n, t.title, t.label]), [
    [1, 'dot form', 'done'],
    [2, 'no colon', 'no status'],
    [3, 'x', 'DONEZO'],
    [4, 'y', 'in progress'],
  ]);
  assert.equal(tickets[3].claimJobId, 'job_a');
});

test('readTicketsFile returns null for a missing file', async () => {
  assert.equal(await readTicketsFile(join(FIXTURES, 'does-not-exist-tickets.md')), null);
});
