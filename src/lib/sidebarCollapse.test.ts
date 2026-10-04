/**
 * SAM — sidebarCollapse.ts: the desktop Sidebar remembers whether Colin
 * folded it to an icon rail, so a reload comes back the way he left it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SIDEBAR_COLLAPSE_KEY,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from './sidebarCollapse.js';

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
  assert.equal(readSidebarCollapsed(new MemoryStorage()), false);
});

test('collapsing survives a reload, and expanding again clears the key', () => {
  const storage = new MemoryStorage();

  writeSidebarCollapsed(storage, true);
  assert.equal(readSidebarCollapsed(storage), true);
  assert.equal(storage.getItem(SIDEBAR_COLLAPSE_KEY), '1');

  writeSidebarCollapsed(storage, false);
  assert.equal(readSidebarCollapsed(storage), false);
  assert.equal(storage.getItem(SIDEBAR_COLLAPSE_KEY), null);
});

test('an unexpected stored value reads as expanded, never as hidden', () => {
  const storage = new MemoryStorage();
  storage.setItem(SIDEBAR_COLLAPSE_KEY, 'yes');
  assert.equal(readSidebarCollapsed(storage), false);
});

test('the key is separate from the chat list collapse key', () => {
  assert.equal(SIDEBAR_COLLAPSE_KEY, 'sam-sidebar-collapsed');
});
