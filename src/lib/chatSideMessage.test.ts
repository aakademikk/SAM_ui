/**
 * SAM — chatSideMessage.ts: side-message routing rules (spec must-do 1, 2,
 * 6, 13; check 1, 13). No React, no DOM — plain objects in, plain values
 * out — so this runs under `node --test` like any other unit test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatTier } from '@/types/chat';

import {
  blockedSendError,
  canTakeSideMessages,
  decideSendRoute,
  handsFreeListens,
  nextComposerText,
  sideRouteTier,
} from './chatSideMessage.js';

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

test('decideSendRoute (review 3): a chat whose handoff is in progress is blocked even on Max/Max 2', () => {
  for (const tier of ALL_TIERS) {
    assert.equal(decideSendRoute({ running: true, tier, handoffWaiting: true }), 'blocked', tier);
  }
});

test('decideSendRoute (review 3): the handoff flag changes nothing when no turn is running or the flag is off', () => {
  for (const tier of ALL_TIERS) {
    assert.equal(decideSendRoute({ running: false, tier, handoffWaiting: true }), 'start', tier);
    assert.equal(
      decideSendRoute({ running: true, tier, handoffWaiting: false }),
      decideSendRoute({ running: true, tier }),
      tier,
    );
  }
});

test('handsFreeListens (review 3): stops listening on a Max chat while its handoff is in progress', () => {
  assert.equal(handsFreeListens({ running: true, tier: 'max', handoffWaiting: true }), false);
  assert.equal(handsFreeListens({ running: true, tier: 'max2', handoffWaiting: true }), false);
  assert.equal(handsFreeListens({ running: false, tier: 'max', handoffWaiting: true }), true);
});

test('sideRouteTier (review 7): a draft has no chat to send into; a chat reads the tier its info carries', () => {
  assert.equal(sideRouteTier({ chatId: 'draft', chatInfoTier: undefined }), 'unknown');
  // Even if a stale info still carries a tier, a draft routes as unknown.
  assert.equal(sideRouteTier({ chatId: 'draft', chatInfoTier: 'max' }), 'unknown');
  assert.equal(sideRouteTier({ chatId: 'abc', chatInfoTier: 'max' }), 'max');
  assert.equal(sideRouteTier({ chatId: 'abc', chatInfoTier: 'gemini' }), 'gemini');
  assert.equal(sideRouteTier({ chatId: 'abc', chatInfoTier: undefined }), 'unknown');
});

test('review 7: the box, hands-free and send() agree for every state of a draft turning into a chat', () => {
  // The three callers all go through sideRouteTier + decideSendRoute with the
  // same inputs; this walks the new-chat sequence on Max.
  const states = [
    { chatId: 'draft', info: undefined, expect: 'blocked' }, // first turn starting, no id yet
    { chatId: 'abc', info: 'max' as const, expect: 'side' }, // id arrived, tier set from the started turn
  ];
  for (const st of states) {
    const route = decideSendRoute({
      running: true,
      tier: sideRouteTier({ chatId: st.chatId, chatInfoTier: st.info }),
    });
    assert.equal(route, st.expect, st.chatId);
    assert.equal(handsFreeListens({ running: true, tier: sideRouteTier({ chatId: st.chatId, chatInfoTier: st.info }) }), st.expect === 'side');
  }
});

test('blockedSendError (review 7): names the handoff when that is the reason, else a plain wait message', () => {
  assert.match(blockedSendError({ handoffWaiting: true }), /handoff/i);
  assert.doesNotMatch(blockedSendError({}), /handoff/i);
  assert.notEqual(blockedSendError({}), '');
});
