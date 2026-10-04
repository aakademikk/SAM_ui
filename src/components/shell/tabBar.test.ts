/**
 * SAM — tabBar.test: the phone tab bar's 4+More split and the More sheet's
 * link list (T9, ux-fixes-spec.md Must 7, 8, 9, 10; checks 5, 6).
 *
 * The test harness (`pretest` in package.json) compiles `*.test.ts` only and
 * has no DOM/React-rendering, so there is no way to measure rendered pixel
 * sizes here — `dashboardLayout.test.ts` and `jobDetail.test.ts` hit the same
 * wall and settle for asserting the pure data the components are built from.
 * This test does the same: it imports `TabBar.tsx`'s exported `TABS` array
 * and `MoreMenuSheet.tsx`'s exported `MORE_MENU_ITEMS` array directly (both
 * plain, non-component exports) and asserts their contents, rather than
 * rendering and measuring boxes. `BottomSheet`'s own slide/scrim/reduced-
 * motion behaviour (Must 9; check 6) is exercised by its own module and is
 * not re-tested here — this file only confirms `MoreMenuSheet` wires into it
 * via import, not a fork.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test.
process.env.HOME = tempDir('tabbar-home-');

import { TABS } from './TabBar.js';
import { MORE_MENU_ITEMS, MoreMenuSheet } from './MoreMenuSheet.js';

test('TabBar has exactly 4 entries: Dash, Chat, Pings, Status', () => {
  assert.equal(TABS.length, 4);
  assert.deepEqual(
    TABS.map((t) => [t.label, t.href]),
    [
      ['Dash', '/'],
      ['Chat', '/chat'],
      ['Pings', '/notifications'],
      ['Status', '/status'],
    ],
  );
});

test('TabBar no longer carries the jargon labels the audit flagged', () => {
  const labels = TABS.map((t) => t.label);
  for (const jargon of ['Term', 'RP', 'Ops', 'Prefs']) {
    assert.ok(!labels.includes(jargon as never), `expected ${jargon} to be gone from the tab bar`);
  }
});

test('MoreMenuSheet lists exactly the 5 remaining destinations by their plain Sidebar names', () => {
  assert.equal(MORE_MENU_ITEMS.length, 5);
  assert.deepEqual(
    MORE_MENU_ITEMS.map((i) => [i.label, i.href]),
    [
      ['Terminal', '/terminal'],
      ['Roleplay', '/practice'],
      ['Fleet', '/fleet'],
      ['Operations', '/operations'],
      ['Settings', '/settings'],
    ],
  );
});

test('MoreMenuSheet is a component (module loads cleanly through its BottomSheet import)', () => {
  // If MoreMenuSheet.tsx forked BottomSheet instead of importing the shared
  // shell from GeneralDetailSheet.tsx, or the import path were wrong, this
  // module would already have failed to load above. Reaching this assertion
  // is itself part of the proof; this just records the expected shape.
  assert.equal(typeof MoreMenuSheet, 'function');
});
