/**
 * SAM — Notifications question rows (answer buttons, T19).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { questionFor, rowView, type QuestionLike } from './questionView.js';

function q(over: Partial<QuestionLike> = {}): QuestionLike {
  return {
    questionId: 'q_0123abcd',
    jobId: 'job_x',
    kind: 'yesno',
    text: 'Relaunch job_x?',
    options: ['Accept', 'Decline'],
    gated: false,
    state: 'open',
    answeredAt: null,
    answeredVia: null,
    result: null,
    ...over,
  };
}

const entry = { id: 'n1', questionId: 'q_0123abcd' };

test('questionView: an entry without a questionId is none', () => {
  assert.equal(rowView({ id: 'n1' }, [q()]).state, 'none');
  assert.equal(rowView({ id: 'n1', questionId: null }, [q()]).state, 'none');
});

test('questionView: a questionId with no matching question is none', () => {
  assert.equal(rowView({ id: 'n1', questionId: 'q_ffffffff' }, [q()]).state, 'none');
  assert.equal(rowView(entry, []).state, 'none');
  assert.equal(questionFor(entry, []), null);
});

test('questionView: an open ordinary question is open with Accept and Decline', () => {
  const v = rowView(entry, [q()]);
  assert.equal(v.state, 'open');
  assert.equal(v.label, 'Relaunch job_x?');
  assert.deepEqual(v.buttons, ['Accept', 'Decline']);
});

test('questionView: an open gated question is gated-open', () => {
  assert.equal(rowView(entry, [q({ gated: true })]).state, 'gated-open');
});

test('questionView: a choice2 question uses its own two labels', () => {
  const v = rowView(entry, [q({ kind: 'choice2', options: ['Red', 'Blue'] })]);
  assert.deepEqual(v.buttons, ['Red', 'Blue']);
});

test('questionView: accepted and declined carry the label, time and result, no buttons', () => {
  const a = rowView(entry, [q({ state: 'accepted', result: 'Accepted', answeredAt: '2026-10-09T10:00:00Z' })]);
  assert.equal(a.state, 'accepted');
  assert.equal(a.label, 'Accepted');
  assert.equal(a.detail, 'Accepted');
  assert.equal(a.answeredAt, '2026-10-09T10:00:00Z');
  assert.deepEqual(a.buttons, []);
  const d = rowView(entry, [q({ state: 'declined', result: 'Declined' })]);
  assert.equal(d.state, 'declined');
  assert.equal(d.label, 'Declined');
  assert.deepEqual(d.buttons, []);
});

test('questionView: failed shows the reason and has no buttons', () => {
  const v = rowView(entry, [q({ state: 'failed', result: 'the seat guard refused it' })]);
  assert.equal(v.state, 'failed');
  assert.equal(v.label, 'the seat guard refused it');
  assert.deepEqual(v.buttons, []);
  assert.equal(rowView(entry, [q({ state: 'failed', result: null })]).label, 'Failed');
});

test('questionView: an unknown state is none', () => {
  assert.equal(rowView(entry, [q({ state: 'weird' })]).state, 'none');
});

test('questionView: joins by questionId among several', () => {
  const v = rowView(entry, [q({ questionId: 'q_11111111', text: 'other' }), q()]);
  assert.equal(v.label, 'Relaunch job_x?');
});
