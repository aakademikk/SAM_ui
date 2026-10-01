/**
 * SAM — tabId.ts: a per-tab id for the focus heartbeat (review finding 9,
 * client half). A fake `sessionStorage` (a plain Map-backed `Storage`) is
 * enough here — this module only ever calls `getItem`/`setItem`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tabId } from './tabId.js';

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

test('tabId mints an id once and reuses it for the same storage (a reload of the same tab)', () => {
  const storage = fakeStorage();
  const first = tabId(storage);
  const second = tabId(storage);
  assert.equal(first, second);
  assert.ok(first.length > 0);
});

test('tabId mints a DIFFERENT id for a different storage (a new tab) — this is what lets the server tell two tabs apart', () => {
  const tabA = tabId(fakeStorage());
  const tabB = fakeStorage();
  // Simulates an OLD client that never generated a tab id reaching this
  // storage first: still gets its own fresh id, never tabA's.
  const tabBId = tabId(tabB);
  assert.notEqual(tabA, tabBId);
});
