import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { frameDue, isBusy, pollWindowUntil, IDLE_FRAME_MS, type PacingState } from './floorPacing.js';
import { emptyFx, FX } from './floorRender.js';

const rest = (over: Partial<PacingState> = {}): PacingState => ({
  wall: 1_000_000, perf: 50_000, fx: emptyFx(), flares: {}, viewT0: 0, hover: false, live: false, ringFires: {}, busyUntil: 0, ...over,
});

function drawsOver(frames: number, busy: boolean): number {
  let last = -Infinity, n = 0;
  for (let i = 0; i < frames; i++) {
    const now = i * 16.7;
    if (frameDue(now, last, busy)) { last = now; n++; }
  }
  return n;
}

describe('floor frame pacing', () => {
  it('draws every frame while busy', () => assert.equal(drawsOver(60, true), 60));
  it('draws at most every 100 ms at rest', () => {
    const n = drawsOver(60, false);
    assert.ok(n <= 12 && n >= 8, `got ${n}`);
    assert.equal(IDLE_FRAME_MS, 100);
  });
  it('is not busy at rest', () => assert.equal(isBusy(rest()), false));
  it('is busy during a zoom, then not', () => {
    assert.equal(isBusy(rest({ viewT0: 50_000 - 900 })), true);
    assert.equal(isBusy(rest({ viewT0: 50_000 - 960 })), false);
  });
  it('is busy for hover and live workers', () => {
    assert.equal(isBusy(rest({ hover: true })), true);
    assert.equal(isBusy(rest({ live: true })), true);
  });
  it('is busy while an effect, idle flip, flare or ring fire is in flight', () => {
    const w = 1_000_000;
    const fx = (o: object) => ({ ...emptyFx(), ...o });
    assert.equal(isBusy(rest({ fx: fx({ dispatches: [{ jobId: 'a', owner: 'sam', at: w - 100 }] }) })), true);
    assert.equal(isBusy(rest({ fx: fx({ dispatches: [{ jobId: 'a', owner: 'sam', at: w - FX.KEEP - 1 }] }) })), false);
    assert.equal(isBusy(rest({ fx: fx({ spawns: { a: w + 1000 } }) })), true);
    assert.equal(isBusy(rest({ fx: fx({ ends: [{ jobId: 'a', owner: 'sam', ok: true, at: w - 100, slot: 0, slots: 1, stageCount: 1 }] }) })), true);
    assert.equal(isBusy(rest({ fx: fx({ idleFlips: { sam: w - 100 } as never }) })), true);
    assert.equal(isBusy(rest({ fx: fx({ idleFlips: { sam: w - 5000 } as never }) })), false);
    assert.equal(isBusy(rest({ fx: fx({ slabDrops: { sam: { at: w - 100, count: 1 } } as never }) })), true);
    assert.equal(isBusy(rest({ flares: { j: w - 100 } })), true);
    assert.equal(isBusy(rest({ flares: { j: w - 5000 } })), false);
    assert.equal(isBusy(rest({ ringFires: { t: w - 100 } })), true);
    assert.equal(isBusy(rest({ busyUntil: 50_500 })), true);
  });

  it('pollWindowUntil opens the window on the first or a changed poll only', () => {
    assert.equal(pollWindowUntil(null, 'a', 1000, 0), 2500);
    assert.equal(pollWindowUntil('a', 'b', 1000, 0), 2500);
    assert.equal(pollWindowUntil('a', 'a', 1000, 700), 700);
  });

  /** 60 fps for `secs`; a floor poll at 0 s and a schedule poll at 1.5 s, each repeating every 3 s. */
  function simulate(secs: number, changedAt: (poll: 'floor' | 'sched', t: number) => boolean, windowFor: typeof pollWindowUntil) {
    const keys: Record<string, string | null> = { floor: null, sched: null };
    const seq: Record<string, number> = { floor: 0, sched: 0 };
    let busyUntil = 0, last = -Infinity, nextFloor = 0, nextSched = 1500;
    const drawsBySec: number[] = new Array(secs).fill(0);
    for (let i = 0; i * 16.7 < secs * 1000; i++) {
      const t = i * 16.7;
      for (const [poll, due] of [['floor', nextFloor], ['sched', nextSched]] as const) {
        if (t < due) continue;
        if (poll === 'floor') nextFloor += 3000; else nextSched += 3000;
        if (changedAt(poll, t)) seq[poll]++;
        const key = poll + seq[poll];
        busyUntil = windowFor(keys[poll], key, t, busyUntil);
        keys[poll] = key;
      }
      const busy = isBusy(rest({ perf: t, busyUntil, viewT0: -10_000 }));
      if (frameDue(t, last, busy)) { last = t; drawsBySec[Math.floor(t / 1000)]++; }
    }
    return drawsBySec;
  }
  it('an idle floor with unchanged polls draws about 10 frames a second', () => {
    const per = simulate(10, () => false, pollWindowUntil);
    // the two first polls hold full rate until 3 s; after that every second is idle
    assert.ok(per.slice(3).every((n) => n <= 12 && n >= 8), `per second ${per.join(',')}`);
    const total = per.reduce((x, y) => x + y, 0);
    assert.ok(total <= 3 * 60 + 7 * 12, `total ${total}`);
  });

  it('a changed poll draws every frame for its window, then drops back', () => {
    const per = simulate(10, (poll, t) => poll === 'floor' && t >= 6000 && t < 6100, pollWindowUntil);
    assert.ok(per[6] >= 58, `changed second ${per.join(',')}`);
    assert.ok(per[7] >= 30 && per[7] <= 45, `window tail ${per.join(',')}`);
    assert.ok(per[8] <= 12 && per[9] <= 12, `back to idle ${per.join(',')}`);
  });
});
