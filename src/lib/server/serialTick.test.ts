/**
 * serialTick: overlapping interval ticks must not both run. The job stream
 * route relies on this so a slow disk read cannot send the same output frames
 * twice (the doubled chat reply of 2026-09-23).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialTick } from './serialTick';

test('a tick that fires while the previous one is running is skipped', async () => {
  let calls = 0;
  let release: () => void = () => {};
  const tick = serialTick(async () => {
    calls++;
    await new Promise<void>((r) => { release = r; });
  });

  const first = tick();
  await tick(); // overlaps the first: must not run
  await tick();
  assert.equal(calls, 1);

  release();
  await first;
  const next = tick(); // the previous has finished, so this one runs
  assert.equal(calls, 2);
  release();
  await next;
});

test('a throwing tick releases the lock', async () => {
  let calls = 0;
  const tick = serialTick(async () => {
    calls++;
    throw new Error('boom');
  });
  await assert.rejects(tick());
  await assert.rejects(tick());
  assert.equal(calls, 2);
});
