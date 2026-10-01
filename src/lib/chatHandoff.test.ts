/**
 * SAM — chatHandoff.ts: clears a chat's handoff fields client-side the
 * moment a new handoff starts (review finding 6, client half — the server
 * half is handoff.test.ts's "a new handoff clears the PREVIOUS attempt's
 * handoffError and handedOffTo" test).
 *
 * `oldPageBehaviour` below is page.tsx's OLD inline logic before this fix:
 * `startHandoff`'s success branch just called `setHandoffWaitingFor(id)` with
 * no update to `chatInfo` at all, so whatever `handoffError`/`handedOffTo`
 * chatInfo already held kept showing right through the new attempt's own
 * waiting window. Run first to show the bug, then `clearedHandoffFields` to
 * show the fix.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearedHandoffFields, type HandoffFields } from './chatHandoff.js';

interface ChatInfo extends HandoffFields {
  tier: string;
  turns: number;
}

function staleChatInfo(): ChatInfo {
  return {
    tier: 'max',
    turns: 4,
    handoffError: 'STALE: previous attempt failed',
    handedOffTo: 'stale-new-chat-id',
  };
}

/** page.tsx's behaviour before this fix: accepting a new handoff never
 *  touched chatInfo's handoff fields at all. */
function oldPageBehaviour(info: ChatInfo): ChatInfo {
  return info;
}

test('finding 6 (client): the OLD behaviour leaves the previous attempt\'s fields in place', () => {
  const result = oldPageBehaviour(staleChatInfo());
  assert.equal(result.handoffError, 'STALE: previous attempt failed');
  assert.equal(result.handedOffTo, 'stale-new-chat-id');
});

test('finding 6 (client): clearedHandoffFields drops a previous attempt\'s error and link', () => {
  const result = clearedHandoffFields(staleChatInfo());
  assert.equal(result.handoffError, undefined);
  assert.equal(result.handedOffTo, undefined);
  // Everything else about the chat is untouched.
  assert.equal(result.tier, 'max');
  assert.equal(result.turns, 4);
});

test('finding 6 (client): a chat with neither field set is unaffected', () => {
  const info: ChatInfo = { tier: 'fast', turns: 0 };
  const result = clearedHandoffFields(info);
  assert.deepEqual(result, info);
});
