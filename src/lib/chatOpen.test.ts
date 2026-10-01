/**
 * SAM — chatOpen.ts: review findings 1 (`/chat?c=` deep links) and 5 (the
 * current chat's record is loaded fresh on mount).
 *
 * `handleChatLink`'s old behaviour (lifted unchanged from page.tsx, stage 1
 * of this ticket) called step-up-gated adopt for an uncached id and always
 * consumed the link regardless of outcome; `mountOpenTarget`'s old behaviour
 * never asked the server for the chat already on screen. These tests were
 * run against that lifted code first to record the failure, then the fix
 * went into chatOpen.ts, which the page now calls.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleChatLink, mountOpenTarget, type ChatLinkDeps } from './chatOpen.js';
import { setCurrentChatId, startDraft } from './chatLocal.js';

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

/* ── Finding 1 ──────────────────────────────────────────────────────────── */

test('finding 1: an uncached chat link opens through the session GET, not adopt', async () => {
  const adoptCalls: string[] = [];
  const openCalls: string[] = [];
  const deps: ChatLinkDeps = {
    isCached: () => false,
    open: async (id) => {
      openCalls.push(id);
      return true;
    },
    adopt: async (id) => {
      adoptCalls.push(id);
      return {};
    },
  };

  await handleChatLink('chat-x', deps);

  assert.deepEqual(adoptCalls, [], 'adopt is never called for a deep link');
  assert.deepEqual(openCalls, ['chat-x']);
});

test('finding 1: a failed open does not consume the link', async () => {
  const deps: ChatLinkDeps = {
    isCached: () => true,
    open: async () => false,
    adopt: async () => {
      throw new Error('adopt must not be called on this path');
    },
  };

  const consume = await handleChatLink('chat-y', deps);

  assert.equal(consume, false, 'the c param stays in the URL so a reload retries it');
});

test('finding 1: a successful open consumes the link', async () => {
  const deps: ChatLinkDeps = { open: async () => true };
  assert.equal(await handleChatLink('chat-z', deps), true);
});

test('finding 1: an archived chat opened via a link stays archived', async () => {
  let archived = true;
  const deps: ChatLinkDeps = {
    isCached: () => false,
    // The session-only GET never touches the archived flag.
    open: async () => true,
    // Only adopt un-archives — proving it, so a regression that starts
    // calling adopt again would also un-archive and fail this.
    adopt: async () => {
      archived = false;
      return {};
    },
  };

  await handleChatLink('chat-archived', deps);

  assert.equal(archived, true, 'a deep-link open must never un-archive the chat');
});

/* ── Finding 5 ──────────────────────────────────────────────────────────── */

test('finding 5: mount force-opens the chat already on screen, so chatInfo loads', () => {
  const storage = new MemoryStorage();
  setCurrentChatId(storage, 'chat-already-current');
  assert.equal(mountOpenTarget(storage), 'chat-already-current');
});

test('finding 5: a draft is never force-opened', () => {
  const storage = new MemoryStorage();
  startDraft(storage);
  assert.equal(mountOpenTarget(storage), null);
});

test('finding 5: no current id yet (a brand-new device) is never force-opened', () => {
  const storage = new MemoryStorage();
  assert.equal(mountOpenTarget(storage), null);
});
