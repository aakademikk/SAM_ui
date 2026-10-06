import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test.
process.env.HOME = tempDir('prefs-store-home-');

import { DEFAULT_LAYOUT, reconcileLayout } from './userPreferencesStore.js';

const OLD_FOUR = [
  { id: 'daily-tasks', size: 'md-tall', visible: true },
  { id: 'money-in', size: 'md-wide', visible: false },
  { id: 'active-projects', size: 'sm', visible: true },
  { id: 'system-health', size: 'lg', visible: true },
];

test('reconcileLayout: a layout saved with the old four widgets gains usage-limits at the end', () => {
  const out = reconcileLayout(OLD_FOUR);
  assert.equal(out.length, 5);
  assert.deepEqual(out.slice(0, 4), OLD_FOUR, 'the four existing widgets keep their order, sizes and visibility');
  assert.deepEqual(out[4], { id: 'usage-limits', size: 'md-wide', visible: true });
});

test('reconcileLayout: a layout that already has usage-limits is unchanged', () => {
  const saved = [{ id: 'usage-limits', size: 'lg', visible: false }, ...OLD_FOUR];
  assert.deepEqual(reconcileLayout(saved), saved);
});

test('DEFAULT_LAYOUT carries the five widgets', () => {
  assert.equal(DEFAULT_LAYOUT.length, 5);
});
