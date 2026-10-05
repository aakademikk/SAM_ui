/**
 * SAM — PreferencesApplier.test: the store is applied as it stands, never a
 * defaults pass first (code review finding 5; floor-fixes Must 11).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startApplying, type Prefs } from './PreferencesApplier.js';

function fakeRoot() {
  const writes: string[] = [];
  const dataset: Record<string, string> = {};
  const root = {
    dataset,
    style: { setProperty: (k: string, v: string) => writes.push(`${k}=${v}`) },
  } as unknown as HTMLElement;
  return { root, writes, dataset };
}

function fakeStore(initial: Prefs) {
  let state = initial;
  const listeners = new Set<(s: Prefs) => void>();
  return {
    getState: () => state,
    subscribe: (l: (s: Prefs) => void) => { listeners.add(l); return () => void listeners.delete(l); },
    set: (next: Prefs) => { state = next; listeners.forEach((l) => l(next)); },
    count: () => listeners.size,
  };
}

test('the saved values are the first and only write: no defaults pass', () => {
  const { root, writes, dataset } = fakeRoot();
  const store = fakeStore({ ambientTheme: 'ember', backgroundIntensity: 0.3, gridOverlay: false } as Prefs);
  const stop = startApplying(root, store);
  assert.equal(dataset.ambient, 'ember');
  assert.equal(writes.length, 2, 'one intensity write and one grid write');
  assert.equal(writes[0], '--sam-bg-intensity=0.30');
  assert.ok(!writes.some((w) => w.includes('0.75')), 'the 0.75 default never lands');
  stop();
});

test('later changes apply at once, and stopping unsubscribes', () => {
  const { root, writes, dataset } = fakeRoot();
  const store = fakeStore({ ambientTheme: 'toxic', backgroundIntensity: 0.75, gridOverlay: true } as Prefs);
  const stop = startApplying(root, store);
  store.set({ ambientTheme: 'ember', backgroundIntensity: 0.5, gridOverlay: true } as Prefs);
  assert.equal(dataset.ambient, 'ember');
  assert.ok(writes.includes('--sam-bg-intensity=0.50'));
  stop();
  assert.equal(store.count(), 0);
});
