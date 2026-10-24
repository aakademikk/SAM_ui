/**
 * SAM: finishedJobsView.test, the finished-jobs row rules (completed-jobs T7).
 *
 * What a row says with and without a closer verdict (must-dos 14, 15, 19),
 * the UTC time (today: `HH:MM`; another day: `DD MMM HH:MM`), and a static
 * render of `FinishedJobsList` for check 23 ("not checked" only on rows with
 * no verdict), check 5's render half (a FAIL verdict on a job that exited 0
 * shows both words) and the row being a real link to `/jobs/<id>`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { FinishedJob } from '../../../types/finishedJobs.js';
import FinishedJobsList from './FinishedJobsList.js';
import { finishedJobsUrl, finishedWhen, primaryTone, rowAriaLabel, rowLabels } from './finishedJobsView.js';

const NOW = Date.parse('2026-10-24T15:30:00Z');

function job(over: Partial<FinishedJob> = {}): FinishedJob {
  return {
    id: 'job_kitchen-r4-implement-t20_20261024-120000',
    name: 'Kitchen build, phase 4',
    general: 'hephaestus',
    endedAt: '2026-10-24T12:05:00Z',
    outcome: 'passed',
    verdict: null,
    ...over,
  };
}

function render(jobs: FinishedJob[] | null, showGeneral = true): string {
  return renderToStaticMarkup(
    createElement(FinishedJobsList, { jobs, title: 'Finished jobs', showGeneral, emptyText: 'No finished jobs yet' }),
  );
}

/** Visible text of the markup, tags dropped (attributes such as title and aria-label are not text). */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

test('no closer record: own outcome, not checked, no verdict', () => {
  for (const [outcome, word] of [['passed', 'Passed'], ['failed', 'Failed'], ['stopped', 'Stopped']] as const) {
    const l = rowLabels(job({ outcome }), NOW);
    assert.equal(l.primary, word);
    assert.equal(l.secondary, null);
    assert.equal(l.notChecked, true);
  }
});

test('PASS (4/4 checks) on a passed job: the verdict only', () => {
  const l = rowLabels(job({ verdict: 'PASS (4/4 checks)' }), NOW);
  assert.equal(l.primary, 'PASS (4/4 checks)');
  assert.equal(l.secondary, null);
  assert.equal(l.notChecked, false);
});

test('FAIL: tests on a job that exited 0: the verdict, plus Passed as the own outcome', () => {
  const l = rowLabels(job({ outcome: 'passed', verdict: 'FAIL: tests' }), NOW);
  assert.equal(l.primary, 'FAIL: tests');
  assert.equal(l.secondary, 'Passed');
  assert.equal(l.notChecked, false);
  assert.equal(primaryTone(job({ outcome: 'passed', verdict: 'FAIL: tests' })), 'bad');
});

test('PASS (2/2 checks) on a failed job: secondary Failed; FAIL on a failed job: none; FAIL on a stopped job: Stopped', () => {
  assert.equal(rowLabels(job({ outcome: 'failed', verdict: 'PASS (2/2 checks)' }), NOW).secondary, 'Failed');
  assert.equal(rowLabels(job({ outcome: 'failed', verdict: 'FAIL: tests' }), NOW).secondary, null);
  assert.equal(rowLabels(job({ outcome: 'stopped', verdict: 'FAIL: tests' }), NOW).secondary, 'Stopped');
});

test('UNKNOWN always shows the own outcome, word for word verdict kept', () => {
  const v = 'UNKNOWN: blocked: T28 route-collisions still FAILs on 05, because the report to SUSPENSE launches from under the fi...';
  const l = rowLabels(job({ outcome: 'passed', verdict: v }), NOW);
  assert.equal(l.primary, v);
  assert.equal(l.secondary, 'Passed');
  assert.equal(primaryTone(job({ verdict: v })), 'neutral');
  assert.ok(rowAriaLabel(l, true).includes(v), 'the full verdict is in the accessible name');
});

test('General label: display name, or SAM for SAM\'s own jobs', () => {
  assert.equal(rowLabels(job(), NOW).generalLabel, 'Hephaestus');
  assert.equal(rowLabels(job({ general: 'sam' }), NOW).generalLabel, 'SAM');
});

test('UTC time: HH:MM today, DD MMM HH:MM on another UTC date', () => {
  assert.equal(finishedWhen('2026-10-24T12:05:00Z', NOW), '12:05');
  assert.equal(finishedWhen('2026-10-24T00:00:00Z', NOW), '00:00');
  assert.equal(finishedWhen('2026-10-23T23:59:00Z', NOW), '23 Oct 23:59');
  assert.equal(finishedWhen('2026-10-07T08:03:00Z', NOW), '07 Oct 08:03');
  // a time zone offset in the stored string is still shown in UTC
  assert.equal(finishedWhen('2026-10-24T01:30:00+02:00', NOW), '23 Oct 23:30');
  assert.equal(finishedWhen('nonsense', NOW), '--:--');
});

test('request URL: fleet, one General, demo', () => {
  assert.equal(finishedJobsUrl(undefined, false), '/api/fleet/finished-jobs');
  assert.equal(finishedJobsUrl(undefined, true), '/api/fleet/finished-jobs?demo=1');
  assert.equal(finishedJobsUrl('cerberus', true), '/api/fleet/finished-jobs?general=cerberus&demo=1');
});

test('check 23: a row with no record renders "not checked"; a row with a valid verdict does not', () => {
  const unchecked = text(render([job({ verdict: null })]));
  assert.match(unchecked, /not checked/);
  const checked = text(render([job({ verdict: 'PASS (3/3 checks)' })]));
  assert.doesNotMatch(checked, /not checked/);
  assert.match(checked, /PASS \(3\/3 checks\)/);
});

test('check 5 (render): FAIL on a job that exited 0 renders both words', () => {
  const out = text(render([job({ outcome: 'passed', verdict: 'FAIL: tests' })]));
  assert.match(out, /FAIL: tests/);
  assert.match(out, /Passed/);
});

test('rows are real links to /jobs/<id>, at least 44 px, no text class under 12 px, no model or cost', () => {
  const a = job({ id: 'job_a_20261024-120000' });
  const b = job({ id: 'job_b_20261023-090000', general: 'sam', endedAt: '2020-01-02T09:10:00Z', outcome: 'failed' });
  const html = render([a, b]);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.ok(html.includes('href="/jobs/job_a_20261024-120000"'));
  assert.ok(html.includes('href="/jobs/job_b_20261023-090000"'));
  assert.equal((html.match(/min-h-\[44px\]/g) ?? []).length, 2);
  for (const m of html.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) assert.ok(Number(m[1]) >= 12, `text-[${m[1]}px]`);
  const out = text(html);
  assert.match(out, /SAM/);
  assert.match(out, /02 Jan 09:10/);
  assert.doesNotMatch(out, /\$|USD|opus|sonnet|haiku/i);
});

test('empty list shows the empty text; nothing is listed while not loaded', () => {
  assert.match(text(render([])), /No finished jobs yet/);
  const loading = render(null);
  assert.doesNotMatch(loading, /No finished jobs yet/);
  assert.doesNotMatch(loading, /<li/);
});

test('showGeneral false leaves the General label out', () => {
  assert.doesNotMatch(text(render([job()], false)), /Hephaestus/);
});
