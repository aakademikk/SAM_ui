/**
 * SAM — chatTier.ts: the tier-lock and tier-display rules (spec must-do 9,
 * 9b; check 7, UI rule — T5 covers the server's own refusal). No React, no
 * DOM — plain objects in, plain values out — so this runs under
 * `node --test` like any other unit test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayTier, tierLocked } from './chatTier.js';

test('tierLocked is false for a draft', () => {
  assert.equal(tierLocked(null), false);
  assert.equal(tierLocked({ id: 'draft' }), false);
  assert.equal(tierLocked({ id: 'draft', turns: 0 }), false);
});

test('tierLocked is true once a chat has sent its first message', () => {
  // A chat id that isn't 'draft' has, by construction, already had its first
  // message — the id comes back from the first send — so it's locked even
  // before a server record's own turns count has caught up.
  assert.equal(tierLocked({ id: 'sess_abc123', turns: 0 }), true);
  assert.equal(tierLocked({ id: 'sess_abc123', turns: 3 }), true);
});

test('displayTier falls back to the draft tier for a draft or no chat', () => {
  assert.equal(displayTier(null, 'fast'), 'fast');
  assert.equal(displayTier({ id: 'draft', tier: 'pro' }, 'gemini'), 'gemini');
});

test('displayTier gives an open chat its own tier', () => {
  assert.equal(displayTier({ id: 'sess_abc123', tier: 'max' }, 'fast'), 'max');
});

test('displayTier returns "Unknown" for an unknown-tier chat', () => {
  assert.equal(displayTier({ id: 'sess_imported', tier: 'unknown' }, 'fast'), 'Unknown');
});
