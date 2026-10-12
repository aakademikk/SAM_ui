/**
 * SAM — push payload to notification options (answer buttons, T15).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildNotification } from './swPush.js';

const base = {
  title: 'SAM asks',
  body: 'Run it?',
  questionId: 'q_0123abcd',
  jobId: 'job_abc-1',
};

test('two actions pass through with tag q-<id> and the job url', () => {
  const { title, options } = buildNotification(
    { ...base, actions: [{ action: 'a', title: 'Accept' }, { action: 'b', title: 'Decline' }] },
    42,
  );
  assert.equal(title, 'SAM asks');
  assert.equal(options.tag, 'q-q_0123abcd');
  assert.deepEqual(options.actions, [
    { action: 'a', title: 'Accept' },
    { action: 'b', title: 'Decline' },
  ]);
  assert.deepEqual(options.data, {
    url: '/jobs/job_abc-1',
    questionId: 'q_0123abcd',
    jobId: 'job_abc-1',
    ts: 42,
  });
});

test('three actions give two, and action id c is dropped', () => {
  const { options } = buildNotification({
    ...base,
    actions: [
      { action: 'c', title: 'Nope' },
      { action: 'a', title: 'Accept' },
      { action: 'b', title: 'Decline' },
      { action: 'a', title: 'Again' },
    ],
  });
  assert.deepEqual(options.actions.map((a) => a.action), ['a', 'b']);
});

test('long titles are cut to 20 characters; non-string titles dropped', () => {
  const { options } = buildNotification({
    ...base,
    actions: [{ action: 'a', title: 'x'.repeat(30) }, { action: 'b', title: 5 }],
  });
  assert.equal(options.actions.length, 1);
  assert.equal(options.actions[0].title, 'x'.repeat(20));
});

test('an explicit url wins; a bad question id falls back to the payload tag', () => {
  const { options } = buildNotification({ ...base, questionId: 'q_nope', url: '/x', tag: 't1' });
  assert.equal(options.tag, 't1');
  assert.equal(options.data.url, '/x');
  assert.equal(options.data.questionId, undefined);
});

test('plain payloads and junk behave as before', () => {
  const plain = buildNotification({ title: 'T', body: 'B', url: '/jobs/job_z', tag: 'sam-1' });
  assert.equal(plain.options.tag, 'sam-1');
  assert.deepEqual(plain.options.actions, []);
  const junk = buildNotification(null);
  assert.equal(junk.title, 'SAM');
  assert.equal(junk.options.tag, 'sam');
  assert.equal(junk.options.data.url, '/');
  assert.deepEqual(buildNotification({ actions: 'a' }).options.actions, []);
});
