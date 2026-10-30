/**
 * SAM — the Approve part of a Notifications row for a Monday-pack ping.
 *
 * No DOM here, so this renders the presentational view to static markup
 * (react-dom/server): pending shows one Approve button (44 px or more to tap),
 * approved shows the word and the time with no button, stale or unknown shows
 * "No longer current" with no button, and a failed status fetch shows nothing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PackApproveRow, PackApproveView, type PackApproveViewProps } from './PackApproveRow.js';

function buttonsOf(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
}

const noop = () => undefined;
const render = (props: Partial<PackApproveViewProps>) =>
  renderToStaticMarkup(createElement(PackApproveView, { state: 'pending', onApprove: noop, ...props }));

test('PackApproveRow: pending shows one Approve button with room to tap', () => {
  const html = render({ state: 'pending' });
  assert.deepEqual(buttonsOf(html), ['Approve']);
  assert.match(html, /min-h-\[44px\]/);
  assert.match(html, /data-pack-state="pending"/);
});

test('PackApproveRow: pending with a message shows the message and keeps the button', () => {
  const html = render({ state: 'pending', message: 'Could not send (500).' });
  assert.deepEqual(buttonsOf(html), ['Approve']);
  assert.ok(html.includes('Could not send (500).'));
});

test('PackApproveRow: a busy press disables the button', () => {
  const html = render({ state: 'pending', busy: true });
  assert.match(html, /<button[^>]*disabled/);
});

test('PackApproveRow: approved shows Approved, the result text and no button', () => {
  const html = render({ state: 'approved', result: 'Approved w/c 26 Oct, 3 lines. Monday 08:00 sends it.', approvedAt: '2026-10-31T21:05:00Z' });
  assert.deepEqual(buttonsOf(html), []);
  assert.ok(html.includes('Approved'));
  assert.ok(html.includes('Approved w/c 26 Oct, 3 lines. Monday 08:00 sends it.'));
  assert.match(html, /data-pack-state="approved"/);
});

test('PackApproveRow: approved with no time still shows Approved and no button', () => {
  const html = render({ state: 'approved' });
  assert.deepEqual(buttonsOf(html), []);
  assert.ok(html.includes('Approved'));
});

test('PackApproveRow: stale and unknown show "No longer current" and no button', () => {
  for (const state of ['stale', 'unknown'] as const) {
    const html = render({ state });
    assert.deepEqual(buttonsOf(html), [], state);
    assert.ok(html.includes('No longer current'), state);
  }
});

test('PackApproveRow: before the status is known, or when it failed, renders nothing', () => {
  assert.equal(render({ state: 'loading' }), '');
  assert.equal(render({ state: 'failed' }), '');
  assert.equal(renderToStaticMarkup(createElement(PackApproveRow, { questionId: 'q_0123abcd' })), '');
});
