import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORK_MIN_WIDTH,
  WORK_WIDTH_KEY,
  clampWorkWidth,
  maxWorkWidth,
  readStoredWidth,
  widthFromPointer,
} from './workWidth.js';

test('max is 70% of the viewport and min is 320', () => {
  assert.equal(WORK_MIN_WIDTH, 320);
  assert.equal(maxWorkWidth(1000), 700);
  assert.equal(maxWorkWidth(1920), 1344);
});

test('clamp holds the width between 320 and 70% of the viewport', () => {
  assert.equal(clampWorkWidth(100, 1200), 320);
  assert.equal(clampWorkWidth(500, 1200), 500);
  assert.equal(clampWorkWidth(5000, 1200), 840);
  assert.equal(clampWorkWidth(Number.NaN, 1200), 320);
});

test('a viewport so narrow that 70% is under 320 still gives 320', () => {
  assert.equal(clampWorkWidth(600, 400), 320);
});

test('dragging left widens: width is the distance from the pointer to the right edge', () => {
  assert.equal(widthFromPointer(700, 1200), 500);
  assert.equal(widthFromPointer(1100, 1200), 320);
  assert.equal(widthFromPointer(0, 1200), 840);
});

test('a persisted width is restored and clamped to the current window', () => {
  const store = (v: string | null) => ({ getItem: (k: string) => (k === WORK_WIDTH_KEY ? v : null) });
  assert.equal(readStoredWidth(store('600'), 1200), 600);
  assert.equal(readStoredWidth(store('1100'), 1200), 840);
  assert.equal(readStoredWidth(store('50'), 1200), 320);
  assert.equal(readStoredWidth(store(null), 1200), null);
  assert.equal(readStoredWidth(store('junk'), 1200), null);
  assert.equal(readStoredWidth({ getItem: () => { throw new Error('denied'); } }, 1200), null);
});
