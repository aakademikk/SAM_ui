/**
 * SAM — chatListCollapse.ts: the desktop chat sidebar remembers whether
 * Colin collapsed it, so a reload comes back the way he left it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLLAPSE_KEY, readListCollapsed, writeListCollapsed } from './chatListCollapse.js';

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

test('the sidebar starts expanded on a device that has never collapsed it', () => {
  assert.equal(readListCollapsed(new MemoryStorage()), false);
});

test('collapsing survives a reload, and expanding again clears it', () => {
  const storage = new MemoryStorage();

  writeListCollapsed(storage, true);
  assert.equal(readListCollapsed(storage), true);
  assert.equal(storage.getItem(COLLAPSE_KEY), '1');

  writeListCollapsed(storage, false);
  assert.equal(readListCollapsed(storage), false);
  assert.equal(storage.getItem(COLLAPSE_KEY), null);
});

test('an unexpected stored value reads as expanded, never as hidden', () => {
  const storage = new MemoryStorage();
  storage.setItem(COLLAPSE_KEY, 'yes');
  assert.equal(readListCollapsed(storage), false);
});
