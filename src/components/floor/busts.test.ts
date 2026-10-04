/**
 * SAM — busts.test: the busts' brightness and Zeus's dispatch flare (T8).
 *
 * Idle busts at 40%, working at full, a 0.3 s ramp either way and none under
 * reduced motion (Must 6, 10); Zeus's flare only inside its ~1.2 s window
 * after a dispatch, never under reduced motion, and only for a dispatch new
 * since the previous poll, once per job (Must 9). No canvas, no DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test (this module reads no files, but the rule is cheap).
process.env.HOME = tempDir('busts-home-');

import {
  BUST_RAMP_MS, FLARE_WINDOW_MS, bustLevel, cardBustAlpha, currentFlare, flareIntensity, recordFlares, workingK,
} from './busts.js';

test('bustLevel: idle 0.4, working 1 when steady', () => {
  assert.equal(bustLevel(true, Infinity), 0.4);
  assert.equal(bustLevel(false, Infinity), 1);
  assert.equal(bustLevel(true, BUST_RAMP_MS), 0.4);
  assert.equal(bustLevel(false, BUST_RAMP_MS), 1);
  assert.equal(bustLevel(false, 5000), 1);
});

test('bustLevel: becoming working ramps up from 0.4 over 300 ms', () => {
  assert.equal(bustLevel(false, 0), 0.4);
  const mid = bustLevel(false, 150);
  assert.ok(mid > 0.4 && mid < 1, `mid-ramp ${mid}`);
  assert.ok(Math.abs(mid - 0.7) < 1e-9, 'linear');
  assert.ok(bustLevel(false, 100) < bustLevel(false, 200));
});

test('bustLevel: becoming idle ramps down to 0.4 over 300 ms (the mockup ramp)', () => {
  assert.equal(bustLevel(true, 0), 1);
  const mid = bustLevel(true, 150);
  assert.ok(mid > 0.4 && mid < 1, `mid-ramp ${mid}`);
  assert.equal(bustLevel(true, 300), 0.4);
});

test('bustLevel: static under reduced motion, no ramp', () => {
  assert.equal(bustLevel(true, 0, true), 0.4);
  assert.equal(bustLevel(true, 150, true), 0.4);
  assert.equal(bustLevel(false, 0, true), 1);
  assert.equal(bustLevel(false, 150, true), 1);
});

test('workingK and cardBustAlpha follow the level', () => {
  assert.equal(workingK(0.4), 0);
  assert.equal(workingK(1), 1);
  assert.equal(cardBustAlpha(0.4), 0.45);
  assert.equal(cardBustAlpha(1), 1);
});

test('flareIntensity: 0 outside the window, positive inside', () => {
  assert.equal(flareIntensity(-1), 0);
  assert.equal(flareIntensity(2000), 0);
  assert.equal(flareIntensity(FLARE_WINDOW_MS + 1), 0);
  assert.equal(flareIntensity(0), 0);
  for (const ms of [20, 80, 200, 300, 600, 1000]) assert.ok(flareIntensity(ms) > 0, `positive at ${ms}`);
  assert.equal(flareIntensity(80), 1, 'the sharp strike peaks at 80 ms');
});

test('flareIntensity: a smaller second strike after about 240 ms', () => {
  const before = flareIntensity(239), after = flareIntensity(280);
  assert.ok(after > before, `second strike lifts it (${before} -> ${after})`);
  assert.ok(after < flareIntensity(80), 'smaller than the first strike');
});

test('flareIntensity: 0 for any input when reduced', () => {
  for (const ms of [-1, 0, 40, 80, 280, 600, 1200, 2000]) assert.equal(flareIntensity(ms, true), 0);
});

test('recordFlares: nothing flares on the first poll after page load', () => {
  const log = recordFlares({}, [{ jobId: 'a' }], 1000, true);
  assert.equal(currentFlare(log, 1080), 0);
});

test('recordFlares: a new dispatch flares once, never twice for the same jobId', () => {
  let log = recordFlares({}, [{ jobId: 'a' }], 1000, true);
  log = recordFlares(log, [{ jobId: 'a' }, { jobId: 'b' }], 5000, false);
  assert.equal(log.b, 5000);
  assert.ok(currentFlare(log, 5080) > 0.9, 'b flares at its dispatch');
  assert.equal(currentFlare(log, 5000 + 2000), 0, 'and is gone after the window');
  // b still listed on the next poll, then dropped and listed again: no second flare
  log = recordFlares(log, [{ jobId: 'b' }], 8000, false);
  log = recordFlares(log, [], 11000, false);
  log = recordFlares(log, [{ jobId: 'b' }], 14000, false);
  assert.equal(log.b, 5000);
  assert.equal(currentFlare(log, 14080), 0);
});

test('recordFlares/currentFlare: no flare with no dispatches, and none under reduced motion', () => {
  const log = recordFlares({}, undefined, 0, false);
  assert.deepEqual(log, {});
  assert.equal(currentFlare(log, 100), 0);
  const l2 = recordFlares({}, [{ jobId: 'x' }], 0, false);
  assert.equal(currentFlare(l2, 80, true), 0);
});
