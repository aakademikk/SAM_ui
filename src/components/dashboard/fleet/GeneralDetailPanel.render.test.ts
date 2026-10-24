/**
 * SAM: GeneralDetailPanel.render.test, static render of a General's panel
 * (completed-jobs T12). Spec check 24 (must-do 20): no "Spend today", no
 * "Earlier today", and no request to `/api/fleet/jobs`; check 4's panel text
 * ("No finished jobs yet") and must-do 11's five rows in "Last 5 finished".
 *
 * The harness compiles `*.test.ts` only and has no DOM, so effects never run
 * and a fetch spied over three timed polls cannot be observed here (ticket
 * T12 step 4's fallback). Instead: the panel's `react-dom/server` output, a
 * source-level check that the panel file names no `/api/fleet/jobs` and makes
 * no fetch of its own, and the finished-jobs URL its poller is given.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { FinishedJob } from '../../../types/finishedJobs.js';
import type { FloorState, FloorWorker } from '../../../types/floor.js';
import GeneralDetailPanel, { GeneralDetailView } from './GeneralDetailPanel.js';
import { finishedJobsUrl } from './finishedJobsView.js';

const NOW = Date.parse('2026-10-09T10:00:00Z');
const PANEL_SRC = join(process.cwd(), 'src/components/dashboard/fleet/GeneralDetailPanel.tsx');

function floor(): FloorState {
  const idle = { idle: true, workers: [] as FloorWorker[] };
  const live = {
    jobId: 'job_live_20261009-095000', general: 'hephaestus', status: 'running', origin: 'manual',
    stages: null, stagesPlanned: null, elapsedMs: 60_000, costUsd: null, startedAt: null, endedAt: null,
    summary: 'Kitchen build', tier: 'main',
  } as FloorWorker;
  return {
    generals: { hermes: idle, calliope: idle, cerberus: idle, prometheus: idle, hephaestus: { idle: false, workers: [live] } },
    samWorkers: [],
    towers: { hermes: 0, hephaestus: 3, calliope: 0, cerberus: 0, prometheus: 0 },
    dispatchFlares: [],
  };
}

function rows(n: number): FinishedJob[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `job_build-${i}_20261009-0${i}0000`,
    name: `Build ${i}`,
    general: 'hephaestus',
    endedAt: new Date(NOW - (i + 1) * 3600_000).toISOString(),
    outcome: 'passed',
    verdict: null,
  }));
}

function view(finished: FinishedJob[] | null): string {
  return renderToStaticMarkup(createElement(GeneralDetailView, { general: 'hephaestus', state: floor(), finished, onClose: () => {} }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

test('check 24: the panel renders no Spend today or Earlier today; the other contents stay', () => {
  const html = renderToStaticMarkup(createElement(GeneralDetailPanel, { general: 'hephaestus', state: floor(), onClose: () => {} }));
  assert.ok(!html.includes('Spend today'), 'no Spend today stat');
  assert.ok(!html.includes('Earlier today'), 'no Earlier today section');
  assert.ok(html.includes('Last 5 finished'), 'the section is there before the first poll answers');
  assert.ok(!html.includes('No finished jobs yet'), 'no empty text while loading');
  for (const kept of ['Running', 'Verified', 'Workers now', 'Kitchen build']) assert.ok(html.includes(kept), `${kept} still shown`);
});

test('check 24: the panel file asks only for finished jobs, through the poller', () => {
  const src = readFileSync(PANEL_SRC, 'utf8');
  assert.equal(src.includes('/api/fleet/jobs'), false, 'no /api/fleet/jobs anywhere in the panel, comments included');
  assert.equal(/\bfetch\s*\(/.test(src), false, 'the panel makes no request of its own');
  assert.ok(src.includes('useFinishedJobs({ general, demo })'), 'the poller is given this General');
  assert.equal(finishedJobsUrl('hephaestus', false), '/api/fleet/finished-jobs?general=hephaestus');
  assert.equal(finishedJobsUrl('hephaestus', true), '/api/fleet/finished-jobs?general=hephaestus&demo=1');
});

test('check 4 and must-do 11: "No finished jobs yet" when empty, five rows when full, nothing while loading', () => {
  const empty = view([]);
  assert.ok(empty.includes('No finished jobs yet'));
  assert.equal(count(empty, 'data-finished-row'), 0);

  const full = view(rows(7));
  assert.equal(count(full, 'data-finished-row'), 5, 'capped at five');
  assert.ok(!full.includes('No finished jobs yet'));
  assert.ok(full.includes('Build 0') && !full.includes('Build 5'), 'the newest five');

  const loading = view(null);
  assert.ok(loading.includes('Last 5 finished'));
  assert.ok(!loading.includes('No finished jobs yet'));
  assert.equal(count(loading, 'data-finished-row'), 0);
});
