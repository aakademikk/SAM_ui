/**
 * SAM — inline Unlock: the shared UnlockPrompt and the step-up helpers behind
 * it. Unlock runs the same biometric step-up the sidebar uses, then retries
 * the failed action once; it never retries on failure or cancel.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StepUpRequiredError } from '@/lib/chatAgentService';
import {
  classifyCallError,
  classifyUploadFailure,
  isStepUpError,
  runUnlock,
} from '@/lib/unlockFlow';

import { CallError, UnlockPrompt } from './UnlockPrompt.js';

function namedError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

test('runUnlock: steps up, then retries once on success', async () => {
  const calls: string[] = [];
  const result = await runUnlock({
    stepUp: async () => { calls.push('stepUp'); },
    retry: async () => { calls.push('retry'); },
  });
  assert.deepEqual(calls, ['stepUp', 'retry']);
  assert.equal(result.status, 'retried');
});

test('runUnlock: no retry when the step-up fails', async () => {
  const calls: string[] = [];
  const result = await runUnlock({
    stepUp: async () => { calls.push('stepUp'); throw new Error('Verification failed'); },
    retry: async () => { calls.push('retry'); },
  });
  assert.deepEqual(calls, ['stepUp']);
  assert.equal(result.status, 'failed');
  assert.equal(result.status === 'failed' && result.message, 'Verification failed');
});

test('runUnlock: no retry and no error shown when the prompt is cancelled', async () => {
  const calls: string[] = [];
  const result = await runUnlock({
    stepUp: async () => { calls.push('stepUp'); throw namedError('NotAllowedError'); },
    retry: async () => { calls.push('retry'); },
  });
  assert.deepEqual(calls, ['stepUp']);
  assert.equal(result.status, 'cancelled');
});

test('runUnlock: with no retry callback it only unlocks', async () => {
  const result = await runUnlock({ stepUp: async () => {} });
  assert.equal(result.status, 'unlocked');
});

test('runUnlock: a retry that reports nothing to retry counts as unlocked only', async () => {
  const result = await runUnlock({ stepUp: async () => {}, retry: async () => false });
  assert.equal(result.status, 'unlocked');
});

test('runUnlock: the retry runs once even if it throws', async () => {
  let retries = 0;
  const result = await runUnlock({
    stepUp: async () => {},
    retry: async () => { retries += 1; throw new Error('boom'); },
  });
  assert.equal(retries, 1);
  assert.equal(result.status, 'retry-failed');
});

test('isStepUpError: recognises the typed error, the flag and the server wording', () => {
  assert.equal(isStepUpError(new StepUpRequiredError()), true);
  assert.equal(isStepUpError(Object.assign(new Error('x'), { stepUpRequired: true })), true);
  assert.equal(isStepUpError(new Error('Step-up required')), true);
  assert.equal(isStepUpError(new Error('Disk full')), false);
  assert.equal(isStepUpError('nope'), false);
});

test('UnlockPrompt renders the message and an Unlock button', () => {
  const html = renderToStaticMarkup(
    createElement(UnlockPrompt, { message: 'Biometric unlock required before SAM can run anything.' }),
  );
  assert.match(html, /Biometric unlock required/);
  assert.match(html, /<button[^>]*>.*Unlock/s);
});

test('chat handoff path: a StepUpRequiredError renders the Unlock button', () => {
  const failure = classifyCallError(new StepUpRequiredError(), 'Could not start handoff.');
  assert.equal(failure.stepUp, true);
  const html = renderToStaticMarkup(createElement(CallError, { failure, onRetry: async () => {} }));
  assert.match(html, /Biometric unlock required/);
  assert.match(html, /Unlock/);
  assert.match(html, /<button/);
});

test('chat handoff path: any other error is plain text with no button', () => {
  const failure = classifyCallError(new Error('Chat not found'), 'Could not start handoff.');
  const html = renderToStaticMarkup(createElement(CallError, { failure, onRetry: async () => {} }));
  assert.match(html, /Chat not found/);
  assert.doesNotMatch(html, /<button/);
});

test('upload path: a 401 stepUpRequired response renders the Unlock button', () => {
  const failure = classifyUploadFailure(401, { stepUpRequired: true });
  assert.equal(failure.stepUp, true);
  const html = renderToStaticMarkup(createElement(CallError, { failure, onRetry: async () => {} }));
  assert.match(html, /Unlock/);
  assert.match(html, /<button/);
});

test('upload path: other failures keep the server message and show no button', () => {
  const failure = classifyUploadFailure(413, { error: 'File too large' });
  assert.equal(failure.stepUp, false);
  assert.equal(failure.message, 'File too large');
  assert.equal(classifyUploadFailure(500, {}).message, 'Upload failed (500)');
});

test('CallError renders nothing when there is no failure', () => {
  assert.equal(renderToStaticMarkup(createElement(CallError, { failure: null, onRetry: async () => {} })), '');
});
