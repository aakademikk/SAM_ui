/**
 * SAM — the reload decision behind BuildWatch.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBuildId, shouldReload } from './buildCheck.js';

const base = { loaded: 'old', served: 'new', busy: false, alreadyReloadedFor: null };

test('shouldReload: a newer build reloads', () => {
  assert.equal(shouldReload(base), true);
});

test('shouldReload: the same build does not', () => {
  assert.equal(shouldReload({ ...base, served: 'old' }), false);
});

test('shouldReload: never while a reply streams or a draft is typed', () => {
  assert.equal(shouldReload({ ...base, busy: true }), false);
});

test('shouldReload: at most one reload per served build', () => {
  assert.equal(shouldReload({ ...base, alreadyReloadedFor: 'new' }), false);
  assert.equal(shouldReload({ ...base, alreadyReloadedFor: 'older' }), true);
});

test('shouldReload: a failed check or no baseline does nothing', () => {
  assert.equal(shouldReload({ ...base, served: null }), false);
  assert.equal(shouldReload({ ...base, loaded: null }), false);
});

test('parseBuildId: reads the envelope, rejects anything else', () => {
  assert.equal(parseBuildId({ data: { buildId: ' abc ' } }), 'abc');
  assert.equal(parseBuildId({ data: { buildId: '' } }), null);
  assert.equal(parseBuildId({ data: {} }), null);
  assert.equal(parseBuildId(null), null);
  assert.equal(parseBuildId('abc'), null);
});
