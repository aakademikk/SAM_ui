/**
 * SAM — chatLocal.ts: per-chat storage, so New never wipes another chat
 * (spec must-do 3, 14; check 2).
 *
 * The first test below was originally written, and first run, against the
 * OLD New behaviour, where `resetConversation` wiped the four legacy flat
 * keys (lifted out of the page unchanged, step 1 of T14) — the only honest
 * way to seed "a chat holding history" was under those keys, since nothing
 * else existed yet. That run genuinely FAILED: wiping the legacy keys threw
 * the chat away (saved as the ticket's required FAIL output). It now runs
 * the page's real sequence against those same legacy-keyed seeds — mount
 * (`migrateLegacy`) then New (`resetConversation`) — because
 * `resetConversation` is this module's public New function, and must never
 * wipe, delete or overwrite a chat however it got onto the device.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessage } from '@/types/chat';
import {
  ACTIVE_KEY,
  MESSAGES_KEY,
  PENDING_KEY,
  SESSION_KEY,
  getCurrentChatId,
  loadChatMessages,
  localChatIds,
  migrateLegacy,
  resetConversation,
} from './chatLocal.js';

/** Node has no localStorage — a plain in-memory Storage stub stands in. */
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

function threeMessages(): ChatMessage[] {
  return [
    { id: 'u_1', role: 'user', blocks: [{ kind: 'text', text: 'hi' }], done: true },
    { id: 'a_1', role: 'assistant', blocks: [{ kind: 'text', text: 'hello' }], done: true },
    { id: 'u_2', role: 'user', blocks: [{ kind: 'text', text: 'how are you' }], done: true },
  ];
}

test('check 2: New must leave a chat holding history intact and listed, even one that ' +
  'arrived under the legacy keys', () => {
  const storage = new MemoryStorage();
  // Chat A is seeded under the pre-upgrade legacy keys — the page's real
  // sequence is mount (migrateLegacy) then New (resetConversation).
  storage.setItem(SESSION_KEY, 'A');
  storage.setItem(MESSAGES_KEY, JSON.stringify(threeMessages()));

  migrateLegacy(storage);
  resetConversation(storage);

  assert.equal(getCurrentChatId(storage), 'draft', 'New points the screen at a fresh draft');
  assert.ok(localChatIds(storage).includes('A'), 'chat A must still be listed after New');
  assert.deepEqual(
    loadChatMessages(storage, 'A'),
    threeMessages(),
    'chat A must keep its full history after New',
  );
});

test('migrateLegacy copies the legacy chat into per-chat storage, keeps the ' +
  'history, and removes the legacy keys', () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, 'B');
  storage.setItem(MESSAGES_KEY, JSON.stringify(threeMessages()));
  storage.setItem(ACTIVE_KEY, JSON.stringify({ jobId: 'j1' }));
  storage.setItem(PENDING_KEY, 'queued message');

  const migrated = migrateLegacy(storage);

  assert.equal(migrated, 'B');
  assert.equal(getCurrentChatId(storage), 'B');
  assert.deepEqual(loadChatMessages(storage, 'B'), threeMessages());
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(storage.getItem(MESSAGES_KEY), null);
  assert.equal(storage.getItem(ACTIVE_KEY), null);
  assert.equal(storage.getItem(PENDING_KEY), null);
});

test('migrateLegacy does nothing when there is no legacy chat to migrate', () => {
  const storage = new MemoryStorage();
  assert.equal(migrateLegacy(storage), null);
  assert.equal(getCurrentChatId(storage), null);
});

test('a reload after New must not re-migrate: migrateLegacy is a no-op once the legacy ' +
  'keys are gone, and the draft stays on screen', () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSION_KEY, 'A');
  storage.setItem(MESSAGES_KEY, JSON.stringify(threeMessages()));

  migrateLegacy(storage);
  resetConversation(storage);

  // Simulates the page remounting (e.g. a reload) after New: nothing wrote
  // the legacy keys again, so this must be a no-op rather than pulling the
  // screen back onto chat A.
  assert.equal(migrateLegacy(storage), null);
  assert.equal(getCurrentChatId(storage), 'draft');
});
