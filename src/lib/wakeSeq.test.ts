/**
 * SAM — wakeSeq.ts: turning a bridge's wake counter into "was I just woken?".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newWakeTracker, observeWakeSeq } from './wakeSeq.js';

test('the first read only sets the baseline, so an old wake does not fire', () => {
  const t = newWakeTracker();
  assert.equal(observeWakeSeq(t, 7), false);
});

test('a changed counter is a wake; the same counter again is not', () => {
  const t = newWakeTracker();
  observeWakeSeq(t, 7);
  assert.equal(observeWakeSeq(t, 8), true);
  assert.equal(observeWakeSeq(t, 8), false);
});

test('a failed read (null) is ignored and keeps the baseline', () => {
  const t = newWakeTracker();
  observeWakeSeq(t, 3);
  assert.equal(observeWakeSeq(t, null), false);
  assert.equal(observeWakeSeq(t, 4), true);
});

test('a counter that went backwards (phone app restarted) is a new baseline, not a wake', () => {
  const t = newWakeTracker();
  observeWakeSeq(t, 5);
  assert.equal(observeWakeSeq(t, 0), false);
  assert.equal(observeWakeSeq(t, 1), true);
});
