/**
 * SAM — pendingSend.ts: review finding 4. A message held for step-up must
 * go back to the chat it was written in, never to whichever chat is on
 * screen when the unlock lands.
 *
 * These tests were first run against a lifted, unchanged copy of the old
 * page.tsx behaviour (a single device-wide `sam-agent-pending` key, blind to
 * which chat wrote it) to record the failure, then the fix went into
 * pendingSend.ts, which the page now calls.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { holdPendingMessage, recoverPendingMessage, supersedePendingMessage } from './pendingSend.js';
import { loadPendingMessage } from './chatLocal.js';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const CHAT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const CHAT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

test('finding 4: a message held for chat A is not sent when chat B is on screen at unlock', () => {
  const storage = new MemoryStorage();
  holdPendingMessage(storage, CHAT_A, 'deploy X');

  const toSend = recoverPendingMessage(storage, CHAT_B);

  assert.equal(toSend, null, 'nothing goes out to the chat on screen');
  assert.equal(loadPendingMessage(storage, CHAT_A), 'deploy X', 'A still holds the message');
});

test('finding 4: reopening the chat it was written in recovers the message', () => {
  const storage = new MemoryStorage();
  holdPendingMessage(storage, CHAT_A, 'deploy X');

  const toSend = recoverPendingMessage(storage, CHAT_A);

  assert.equal(toSend, 'deploy X');
  assert.equal(loadPendingMessage(storage, CHAT_A), null, 'recovering clears the hold');
});

test('finding 4: a fresh send on chat A clears only A\'s own held message', () => {
  const storage = new MemoryStorage();
  holdPendingMessage(storage, CHAT_A, 'deploy X');
  holdPendingMessage(storage, CHAT_B, 'deploy Y');

  supersedePendingMessage(storage, CHAT_A);

  assert.equal(loadPendingMessage(storage, CHAT_A), null);
  assert.equal(loadPendingMessage(storage, CHAT_B), 'deploy Y', 'an unrelated chat is untouched');
});
