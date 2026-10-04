/**
 * SAM — chatSideMessage.ts: side-message routing rules (spec must-do 1, 2,
 * 6, 13; check 1, 13). No React, no DOM — plain objects in, plain values
 * out — so this runs under `node --test` like any other unit test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatTier } from '@/types/chat';

import { canTakeSideMessages, decideSendRoute, handsFreeListens, nextComposerText } from './chatSideMessage.js';

const ALL_TIERS: ChatTier[] = ['fast', 'pro', 'max', 'max2', 'gemini', 'unknown'];

test('canTakeSideMessages is true for Max and Max 2 only', () => {
  for (const tier of ALL_TIERS) {
    assert.equal(canTakeSideMessages(tier), tier === 'max' || tier === 'max2', tier);
  }
});

test('decideSendRoute: not running is always "start", regardless of tier', () => {
  for (const tier of ALL_TIERS) {
    assert.equal(decideSendRoute({ running: false, tier }), 'start', tier);
  }
});

test('decideSendRoute: running + Max/Max 2 is "side"', () => {
  assert.equal(decideSendRoute({ running: true, tier: 'max' }), 'side');
  assert.equal(decideSendRoute({ running: true, tier: 'max2' }), 'side');
});

test('decideSendRoute: running + Fast/Pro/Gemini/unknown is "blocked"', () => {
  assert.equal(decideSendRoute({ running: true, tier: 'fast' }), 'blocked');
  assert.equal(decideSendRoute({ running: true, tier: 'pro' }), 'blocked');
  assert.equal(decideSendRoute({ running: true, tier: 'gemini' }), 'blocked');
  assert.equal(decideSendRoute({ running: true, tier: 'unknown' }), 'blocked');
});

test('handsFreeListens: always true when nothing is running', () => {
  for (const tier of ALL_TIERS) {
    assert.equal(handsFreeListens({ running: false, tier }), true, tier);
  }
});

test('handsFreeListens: true during a running turn only on Max/Max 2', () => {
  for (const tier of ALL_TIERS) {
    assert.equal(
      handsFreeListens({ running: true, tier }),
      tier === 'max' || tier === 'max2',
      tier,
    );
  }
});

test('nextComposerText: delivered clears the composer', () => {
  assert.equal(nextComposerText(true, 'hello'), '');
});

test('nextComposerText: a failed send keeps the text on screen', () => {
  assert.equal(nextComposerText(false, 'hello'), 'hello');
});
