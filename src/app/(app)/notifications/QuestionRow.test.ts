/**
 * SAM — the question part of a Notifications row, for choice questions.
 *
 * No DOM here, so this renders static markup (react-dom/server) and reads the
 * buttons out of it: one per choice, in order, wrapping (not one fixed row) so
 * six labels fit a 360 px phone, and each of them 44 px or more to tap.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { QuestionLike } from '@/lib/questionView';

import { QuestionRow } from './QuestionRow.js';

function q(over: Partial<QuestionLike> = {}): QuestionLike {
  return {
    questionId: 'q_0123abcd',
    jobId: 'job_x',
    kind: 'yesno',
    text: 'How should sfx-onset pass? (a) approve, (b) re-space, (c) accept the fail.',
    options: ['Accept', 'Decline'],
    gated: false,
    state: 'open',
    answeredAt: null,
    answeredVia: null,
    result: null,
    ...over,
  };
}

function buttonsOf(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
}

const render = (question: QuestionLike) => renderToStaticMarkup(createElement(QuestionRow, { question }));

test('QuestionRow: a three-way question renders three buttons, not Accept and Decline', () => {
  const html = render(q({ kind: 'choice', options: ['a) Approve', 'b) keep the check', 'c) accept sfx-onset'] }));
  assert.deepEqual(buttonsOf(html), ['a) Approve', 'b) keep the check', 'c) accept sfx-onset']);
  assert.equal(html.includes('>Accept<'), false);
});

test('QuestionRow: six choices render six buttons that wrap, each with room to tap', () => {
  const options = ['a) one', 'b) two', 'c) three', 'd) four', 'e) five', 'f) six'];
  const html = render(q({ kind: 'choice', options }));
  assert.deepEqual(buttonsOf(html), options);
  assert.match(html, /<div class="[^"]*flex-wrap[^"]*" data-role="question-buttons">/);
  assert.equal((html.match(/min-h-\[44px\]/g) ?? []).length, 6);
  assert.equal((html.match(/min-w-\[calc\(50%-0\.25rem\)\]/g) ?? []).length, 6);
});

test('QuestionRow: yes/no and choice2 still render their two buttons', () => {
  assert.deepEqual(buttonsOf(render(q())), ['Accept', 'Decline']);
  assert.deepEqual(buttonsOf(render(q({ kind: 'choice2', options: ['Red', 'Blue'] }))), ['Red', 'Blue']);
});

test('QuestionRow: a gated choice question shows Open only until the step-up', () => {
  const html = render(q({ kind: 'choice', gated: true, options: ['a) one', 'b) two', 'c) three'] }));
  assert.deepEqual(buttonsOf(html), ['Open']);
});

test('QuestionRow: an answered choice question shows what was chosen and no buttons', () => {
  const html = render(q({
    kind: 'choice',
    state: 'accepted',
    result: 'Chose c) accept sfx-onset',
    options: ['a) one', 'b) two', 'c) accept sfx-onset'],
    answeredAt: '2026-10-10T16:40:00Z',
  }));
  assert.deepEqual(buttonsOf(html), []);
  assert.ok(html.includes('Chose c) accept sfx-onset'));
});
