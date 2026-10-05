/**
 * SAM — tileLayout.test: the pure order / size / hidden logic behind the
 * fleet dashboard's three tiles (floor-fixes T2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_TILES,
  TILE_HEIGHT_SM,
  TILE_LAYOUT_STORAGE_KEY,
  canMove,
  focusAfterHide,
  hiddenTiles,
  hideTile,
  moveTile,
  reconcileTiles,
  reorderTiles,
  restoreTile,
  setTileSize,
  tileHeight,
  visibleTiles,
  type TileItem,
} from './tileLayout';

const ids = (items: TileItem[]) => items.map((t) => t.id);

test('defaults: order and sizes', () => {
  assert.deepEqual(ids(DEFAULT_TILES), ['system-health', 'daily-tasks', 'money-in', 'usage-limits']);
  assert.ok(DEFAULT_TILES.every((t) => !t.hidden));
  assert.deepEqual(
    DEFAULT_TILES.map((t) => t.size),
    ['sm', 'sm', 'sm', 'tall'],
    'usage-limits is tall so both windows and reset times fit (spec U1)',
  );
});

test('reconcile: a saved layout of the old three gains usage-limits last', () => {
  const old = [
    { id: 'money-in', size: 'tall', hidden: false },
    { id: 'system-health', size: 'sm', hidden: true },
    { id: 'daily-tasks', size: 'sm', hidden: false },
  ];
  const out = reconcileTiles(old);
  assert.deepEqual(ids(out), ['money-in', 'system-health', 'daily-tasks', 'usage-limits']);
  assert.deepEqual(out.slice(0, 3), old, 'the three saved tiles keep order, size and hidden');
  assert.deepEqual(out[3], { id: 'usage-limits', size: 'tall', hidden: false });
});

test('reconcile: non-array gives defaults', () => {
  for (const bad of [null, undefined, 'x', 42, { a: 1 }]) {
    assert.deepEqual(reconcileTiles(bad), DEFAULT_TILES);
  }
});

test('reconcile: drops unknown ids, duplicates and junk entries', () => {
  const out = reconcileTiles([
    null,
    'money-in',
    { id: 'nope', size: 'sm' },
    { id: 'money-in', size: 'tall', hidden: true },
    { id: 'money-in', size: 'sm' },
  ]);
  assert.deepEqual(ids(out), ['money-in', 'system-health', 'daily-tasks', 'usage-limits']);
  assert.deepEqual(out[0], { id: 'money-in', size: 'tall', hidden: true });
});

test('reconcile: appends missing tiles in default order', () => {
  const out = reconcileTiles([{ id: 'daily-tasks', size: 'sm', hidden: false }]);
  assert.deepEqual(ids(out), ['daily-tasks', 'system-health', 'money-in', 'usage-limits']);
});

test('reconcile: repairs bad sizes and bad hidden', () => {
  const out = reconcileTiles([
    { id: 'system-health', size: 'huge', hidden: 'yes' },
    { id: 'daily-tasks', size: 'md-wide', hidden: 1 },
  ]);
  assert.deepEqual(out[0], { id: 'system-health', size: 'sm', hidden: false });
  assert.deepEqual(out[1], { id: 'daily-tasks', size: 'sm', hidden: false });
});

test('reorder: arrayMove semantics and no-ops', () => {
  assert.deepEqual(ids(reorderTiles(DEFAULT_TILES, 'system-health', 'money-in')), [
    'daily-tasks',
    'money-in',
    'system-health',
    'usage-limits',
  ]);
  assert.deepEqual(ids(reorderTiles(DEFAULT_TILES, 'money-in', 'system-health')), [
    'money-in',
    'system-health',
    'daily-tasks',
    'usage-limits',
  ]);
  assert.equal(reorderTiles(DEFAULT_TILES, 'money-in', 'money-in'), DEFAULT_TILES);
  assert.equal(
    reorderTiles(DEFAULT_TILES, 'bogus' as never, 'money-in'),
    DEFAULT_TILES,
  );
});

test('move: steps among visible tiles, hidden keep their slot', () => {
  const items = hideTile(DEFAULT_TILES, 'daily-tasks');
  const moved = moveTile(items, 'system-health', 1);
  assert.deepEqual(ids(moved), ['money-in', 'daily-tasks', 'system-health', 'usage-limits']);
  assert.equal(moved[1].hidden, true);
  assert.deepEqual(ids(moveTile(moved, 'system-health', -1)), ids(items));
});

test('move: at the ends is a no-op returning the same array', () => {
  assert.equal(moveTile(DEFAULT_TILES, 'system-health', -1), DEFAULT_TILES);
  assert.equal(moveTile(DEFAULT_TILES, 'usage-limits', 1), DEFAULT_TILES);
  assert.equal(canMove(DEFAULT_TILES, 'system-health', -1), false);
  assert.equal(canMove(DEFAULT_TILES, 'system-health', 1), true);
  assert.equal(canMove(DEFAULT_TILES, 'usage-limits', 1), false);
  assert.equal(canMove(DEFAULT_TILES, 'money-in', 1), true);
  const hiddenEnd = hideTile(hideTile(DEFAULT_TILES, 'usage-limits'), 'money-in');
  assert.equal(canMove(hiddenEnd, 'daily-tasks', 1), false);
});

test('hide then restore returns the same place and size', () => {
  const sized = setTileSize(DEFAULT_TILES, 'daily-tasks', 'tall');
  const hidden = hideTile(sized, 'daily-tasks');
  assert.deepEqual(ids(visibleTiles(hidden)), ['system-health', 'money-in', 'usage-limits']);
  assert.deepEqual(ids(hiddenTiles(hidden)), ['daily-tasks']);
  assert.deepEqual(restoreTile(hidden, 'daily-tasks'), sized);
});

test('tileHeight: sm and tall', () => {
  assert.equal(TILE_HEIGHT_SM, 176);
  assert.equal(tileHeight('sm'), 176);
  assert.equal(tileHeight('tall'), 2 * 176 + 12);
  assert.equal(tileHeight('tall', 8), 2 * 176 + 8);
});

test('storage key is its own and not the preferences key', () => {
  assert.equal(TILE_LAYOUT_STORAGE_KEY, 'sam.fleet-tiles.v1');
  assert.notEqual(TILE_LAYOUT_STORAGE_KEY, 'sam.preferences.v1');
});

test('focusAfterHide: next visible tile, else the previous, else null', () => {
  const t = (id: TileItem['id'], hidden = false): TileItem => ({ id, size: 'sm', hidden });
  const all = [t('system-health'), t('daily-tasks'), t('money-in')];
  assert.equal(focusAfterHide(all, 'system-health'), 'daily-tasks', 'first: the next');
  assert.equal(focusAfterHide(all, 'daily-tasks'), 'money-in', 'middle: the next');
  assert.equal(focusAfterHide(all, 'money-in'), 'daily-tasks', 'last: the previous');
  const skip = [t('system-health'), t('daily-tasks', true), t('money-in')];
  assert.equal(focusAfterHide(skip, 'system-health'), 'money-in', 'steps over a hidden tile');
  assert.equal(focusAfterHide(skip, 'money-in'), 'system-health');
  assert.equal(focusAfterHide([t('system-health'), t('daily-tasks', true), t('money-in', true)], 'system-health'), null, 'none left: the Hidden button');
});
