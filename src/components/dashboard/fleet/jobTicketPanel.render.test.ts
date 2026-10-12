/**
 * SAM — jobTicketPanel.render.test: static render of the job detail card
 * (job ticket panel, T13). Spec checks 7 and 8 (what can be proved before
 * deploy): tickets mode lists 24 long-titled tickets with the live heading and
 * nothing that can force sideways scroll on a 390 px phone; stages mode keeps
 * today's output, plus the one-line notice when present.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { JobTicketPanel } from '../../../lib/server/fleet/jobTicketPanel.js';
import type { FloorWorker } from '../../../types/floor.js';
import { JobDetailCard, TICKET_REFRESH_MS } from './JobDetailModule.js';

const NOW = Date.parse('2026-10-09T10:00:00Z');
const LONG_JOB = 'job_kitchen-r4-implement-t20-with-a-very-long-name_20261008-205319';

function worker(over: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId: LONG_JOB,
    general: 'hephaestus',
    status: 'running',
    origin: 'job',
    stages: null,
    stagesPlanned: null,
    elapsedMs: 65_000,
    costUsd: null,
    startedAt: null,
    endedAt: null,
    summary: 'Kitchen build, launch summary says 19 of 24',
    tier: 'main',
    ...over,
  } as FloorWorker;
}

function ticketsPanel(): Extract<JobTicketPanel, { mode: 'tickets' }> {
  const tickets = Array.from({ length: 24 }, (_, i) => {
    const n = i + 1;
    const label = n <= 20 ? 'DONE' : n === 21 ? 'IN PROGRESS' : 'TODO';
    return {
      n,
      title: `Ticket ${n}: ${'a very long ticket title that must wrap '.repeat(4)}`,
      label,
      claimJobId: n === 21 ? LONG_JOB : null,
      claim: n === 21 ? { jobId: LONG_JOB, running: true, stalled: false } : null,
    };
  });
  return {
    mode: 'tickets',
    ticketsPath: '/x/implementation/kitchen-tickets.md',
    tickets,
    done: 20,
    total: 24,
    heading: '20 of 24 tickets done',
    jobs: [{ id: LONG_JOB, state: 'running', startedAt: '2026-10-09T09:00:00Z', endedAt: null }],
    lastActivity: '2026-10-09T09:55:00Z',
    failedRuns: { count: 1, recent: [{ command: 'npm test '.repeat(30), exitCode: 143, timedOut: true }] },
  } as unknown as Extract<JobTicketPanel, { mode: 'tickets' }>;
}

const render = (props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(JobDetailCard, { worker: worker(), now: NOW, ...props } as never));

test('tickets mode: 24 tickets, live heading, long IN PROGRESS id, no overflow hooks', () => {
  const html = render({ panel: ticketsPanel() });
  assert.ok(html.includes('20 of 24 tickets done'));
  assert.equal((html.match(/<li /g) ?? []).length >= 24, true);
  assert.ok(html.includes('IN PROGRESS'));
  assert.ok(html.includes(LONG_JOB));
  assert.ok(html.includes('last activity 5 min ago'));
  assert.ok(html.includes('timed out'));
  assert.ok(!html.includes('Stage'), 'tickets mode has no Stages stat');

  // Every class attribute: whitespace-nowrap only alongside truncate.
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    const cls = m[1];
    if (cls.includes('whitespace-nowrap')) assert.ok(/\btruncate\b|break-words/.test(cls), cls);
  }
  // No fixed pixel width over 360 (class or inline style).
  for (const m of html.matchAll(/\b(?:min-|max-)?w-\[(\d+)px\]/g)) assert.ok(Number(m[1]) <= 360, m[0]);
  for (const m of html.matchAll(/(?:^|[;"\s])(?:min-|max-)?width:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 360, m[0]);
  // Ticket lists scroll vertically only.
  assert.ok(/aria-label="Tickets"[^>]*overflow-y-auto/.test(html) || /overflow-y-auto[^>]*aria-label="Tickets"/.test(html));
  assert.ok(!/overflow-x-(auto|scroll)/.test(html));
});

test('stages mode: unchanged, "no stage data" for a job with no stage data', () => {
  const html = render({ panel: { mode: 'stages' } });
  assert.ok(html.includes('Stages'));
  assert.ok(html.includes('no stage data'));
  assert.ok(!html.includes('tickets done'));
  assert.equal(html, render({ panel: null }));
});

test('stages mode with a notice shows the one line; the stages view stays', () => {
  const html = render({ panel: { mode: 'stages', notice: 'Tickets file not found (worktree removed?): showing stages.' } });
  assert.ok(html.includes('Tickets file not found'));
  assert.ok(html.includes('no stage data'));
});

test('the panel refresh is never faster than the floor poll', () => {
  assert.ok(TICKET_REFRESH_MS >= 3000);
});
