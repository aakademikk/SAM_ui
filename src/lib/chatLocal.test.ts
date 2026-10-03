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
  saveChatMessages,
  setCurrentChatId,
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

/* ---------- a full device: the cache must never throw (Colin's laptop, 2026-10-03) ---------- */

/** Storage with the browser's behaviour at its quota: a write that would take it over throws QuotaExceededError. */
class QuotaStorage extends MemoryStorage {
  constructor(private readonly limit: number) { super(); }
  private used(except: string): number {
    let n = 0;
    for (let i = 0; i < this.length; i += 1) {
      const k = this.key(i)!;
      if (k !== except) n += k.length + (this.getItem(k) ?? '').length;
    }
    return n;
  }
  override setItem(key: string, value: string): void {
    if (this.used(key) + key.length + value.length > this.limit) {
      throw new DOMException(`Setting the value of '${key}' exceeded the quota.`, 'QuotaExceededError');
    }
    super.setItem(key, value);
  }
}

const bigMessages = (n: number, size: number): ChatMessage[] => Array.from({ length: n }, (_, i) => ({
  id: `m_${i}`, role: i % 2 ? 'assistant' : 'user', blocks: [{ kind: 'text', text: 'x'.repeat(size) }], done: true,
}));

test('a full device: saving a chat evicts other chats\' caches, oldest first, instead of throwing', () => {
  const st = new QuotaStorage(30_000);
  saveChatMessages(st, 'old', bigMessages(4, 2_000));
  saveChatMessages(st, 'mid', bigMessages(4, 2_000));
  saveChatMessages(st, 'new', bigMessages(4, 2_000));
  assert.doesNotThrow(() => saveChatMessages(st, 'current', bigMessages(4, 3_000)));
  assert.equal(loadChatMessages(st, 'current').length, 4, 'the chat on screen is saved whole');
  assert.equal(loadChatMessages(st, 'old').length, 0, 'the least recently saved chat went first');
  assert.equal(loadChatMessages(st, 'new').length, 4, 'the most recent other chat is kept while there is room');
});

test('a full device: a chat too big on its own keeps its most recent messages, or nothing, and never throws', () => {
  const st = new QuotaStorage(10_000);
  assert.doesNotThrow(() => saveChatMessages(st, 'huge', bigMessages(10, 3_000)));
  const kept = loadChatMessages(st, 'huge');
  assert.ok(kept.length >= 1 && kept.length < 10, `kept ${kept.length}`);
  assert.equal(kept[kept.length - 1].id, 'm_9', 'the newest message survives');
  assert.doesNotThrow(() => saveChatMessages(st, 'huge', bigMessages(1, 50_000)));
  assert.equal(loadChatMessages(st, 'huge').length, 0, 'one message bigger than the device: no cache, no throw');
});

test('a device already full when Colin opens a chat: pointing at it makes room instead of throwing', () => {
  const st = new QuotaStorage(10_000);
  saveChatMessages(st, 'a', bigMessages(3, 3_000));
  for (let n = 1; ; n += 1) { try { st.setItem(`fill${n}`, 'z'.repeat(40)); } catch { break; } } // the device is now full
  assert.doesNotThrow(() => setCurrentChatId(st, 'b'));
  assert.equal(getCurrentChatId(st), 'b');
  assert.equal(loadChatMessages(st, 'a').length, 0, 'the other chat\'s cache made the room');
});
