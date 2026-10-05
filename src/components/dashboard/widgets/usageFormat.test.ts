/**
 * SAM — usageFormat.test: the usage tile's words (T5; U1, U2).
 * Explicit `now`; times are London whatever the machine zone.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test.
process.env.HOME = tempDir('usageformat-home-');

import type { UsageWindow } from '../../../types/usage.js';
import { formatAge, formatReset, windowLine } from './usageFormat.js';

// Mon 2026-10-05 15:00 London (BST, UTC+1).
const NOW = Date.parse('2026-10-05T14:00:00Z');
const win = (extra: Partial<UsageWindow>): UsageWindow => ({
  pct: 12, resetsAt: '2026-10-05T17:40:00Z', readAt: '2026-10-05T13:45:00Z', state: 'current', ...extra,
});

test('formatAge: just now, minutes, hours, days (floored)', () => {
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  assert.equal(formatAge(ago(30_000), NOW), 'read just now');
  assert.equal(formatAge(ago(60_000), NOW), 'read 1 min ago');
  assert.equal(formatAge(ago(14 * 60_000 + 59_000), NOW), 'read 14 min ago');
  assert.equal(formatAge(ago(3 * 3_600_000 + 1_000_000), NOW), 'read 3 h ago');
  assert.equal(formatAge(ago(2 * 86_400_000 + 5 * 3_600_000), NOW), 'read 2 d ago');
  assert.equal(formatAge(ago(-5_000), NOW), 'read just now');
});

test('formatReset: same day, another day, null, London summer and winter', () => {
  assert.equal(formatReset('2026-10-05T17:40:00Z', NOW), 'resets 18:40');
  assert.equal(formatReset('2026-10-12T22:00:00Z', NOW), 'resets Mon 23:00');
  assert.equal(formatReset(null, NOW), 'reset time not recorded');
  assert.equal(formatReset('nonsense', NOW), 'reset time not recorded');
  // Winter: GMT, no offset.
  assert.equal(formatReset('2026-12-14T23:00:00Z', Date.parse('2026-12-10T12:00:00Z')), 'resets Mon 23:00');
  // London midnight is the day boundary, not UTC's.
  assert.equal(formatReset('2026-10-05T23:30:00Z', NOW), 'resets Tue 00:30');
});

test('windowLine: current, with tones at the 60 and 80 edges', () => {
  assert.deepEqual(windowLine(win({}), NOW), { text: '12%', sub: 'resets 18:40', tone: 'ok' });
  assert.equal(windowLine(win({ pct: 59 }), NOW).tone, 'ok');
  assert.equal(windowLine(win({ pct: 60 }), NOW).tone, 'warn');
  assert.equal(windowLine(win({ pct: 79 }), NOW).tone, 'warn');
  assert.equal(windowLine(win({ pct: 80 }), NOW).tone, 'high');
  assert.equal(windowLine(win({ pct: 100 }), NOW).tone, 'high');
});

test('windowLine: reset shows no percent anywhere (U2)', () => {
  const l = windowLine(win({ pct: null, resetsAt: '2026-10-05T12:00:00Z', readAt: '2026-10-05T13:05:00Z', state: 'reset' }), NOW);
  assert.deepEqual(l, { text: 'reset', sub: 'not checked since 14:05', tone: 'reset' });
  assert.doesNotMatch(l.text, /\d+\s*%/);
  assert.doesNotMatch(l.sub, /\d+\s*%/);
  // Even if a stale pct leaks through on a reset window, it is not shown.
  const leaked = windowLine(win({ pct: 91, state: 'reset', readAt: '2026-10-03T09:05:00Z' }), NOW);
  assert.equal(leaked.text, 'reset');
  assert.doesNotMatch(leaked.text + leaked.sub, /\d+\s*%/);
  assert.equal(leaked.sub, 'not checked since Sat 10:05');
});

test('windowLine: unknown-reset keeps the percent, says the reset is not recorded', () => {
  assert.deepEqual(windowLine(win({ pct: 65, resetsAt: null, state: 'unknown-reset' }), NOW),
    { text: '65%', sub: 'reset time not recorded', tone: 'warn' });
});

test('windowLine: null is no reading yet', () => {
  assert.deepEqual(windowLine(null, NOW), { text: '', sub: 'no reading yet', tone: 'none' });
});

test('windowLine: current with no recorded reset time', () => {
  assert.equal(windowLine(win({ resetsAt: null }), NOW).sub, 'reset time not recorded');
});
