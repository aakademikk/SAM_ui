/**
 * SAM — floorRender.test: the floor canvas's pure geometry (T7).
 *
 * Given a fixed `FloorState`, the scene has five General stations plus SAM's
 * plinth and node, one worker figure per queued or running job (Must 7), an
 * idle flag on every bust slot that T8 reads (Must 10), one slab per job
 * verified today (Must 12), no travelling lights under reduced motion
 * (Must 6), and the dispatch pulse / teal return only on the matching
 * transitions between two polls (Must 9, 11). No canvas, no DOM.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';

// House rule: a fresh HOME before importing anything under test (this module reads no files, but the rule is cheap).
process.env.HOME = fs.mkdtempSync(`${os.tmpdir()}/floorrender-home-`);

import type { FloorState, FloorWorker, GeneralId } from '../../types/floor.js';
import {
  ACC, BAD, CORE, DEEP, DESKTOP_OPTIONS, EDGE, FX, GENERALS, LAPTOP_OPTIONS, MIST, TEAL,
  buildScene, computeLayout, diffFloor, emptyFx, figureCounts, hitGeneral, samLink, toX,
} from './floorRender.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function worker(jobId: string, general: GeneralId | 'sam', status: FloorWorker['status'], extra: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId, general, status, origin: 'chat', stages: null, stagesPlanned: null, elapsedMs: 60_000, costUsd: null,
    startedAt: iso(120_000), endedAt: null, ...extra,
  };
}

function fixture(): FloorState {
  return {
    generals: {
      hermes: { idle: true, workers: [worker('job-old-fail', 'hermes', 'failed', { endedAt: iso(3 * 3600_000) })] },
      hephaestus: {
        idle: false,
        workers: [
          worker('job-build', 'hephaestus', 'running', {
            startedAt: iso(300_000),
            stagesPlanned: ['grill', 'spec', 'build'],
            stages: [{ name: 'grill', state: 'done' }, { name: 'spec', state: 'now' }, { name: 'build', state: 'todo' }],
          }),
          worker('job-second', 'hephaestus', 'running', { startedAt: iso(100_000) }),
        ],
      },
      calliope: { idle: true, workers: [worker('job-fresh-fail', 'calliope', 'failed', { endedAt: iso(5_000) })] },
      cerberus: { idle: true, workers: [worker('job-queued', 'cerberus', 'queued')] },
      prometheus: { idle: false, workers: [worker('job-bench', 'prometheus', 'running')] },
    },
    samWorkers: [worker('job-legacy', 'sam', 'running')],
    towers: { hermes: 6, hephaestus: 4, calliope: 0, cerberus: 3, prometheus: 2 },
    dispatchFlares: [],
  };
}

const layout = computeLayout(1100, 640, DESKTOP_OPTIONS);
const figuresOf = (sc: ReturnType<typeof buildScene>, owner: GeneralId | 'sam') => sc.figures.filter((f) => f.owner === owner && !f.returned);

test('the scene has five General stations plus SAM, in the mockup order, SAM above the row', () => {
  const sc = buildScene(fixture(), layout, { now: NOW });
  assert.equal(sc.stations.length, 5);
  assert.deepEqual(sc.stations.map((s) => s.id), ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus']);
  assert.ok(sc.plinth.base.top.length === 4 && sc.plinth.top.top.length === 4, 'SAM plinth drawn (two tiers)');
  // SAM's node at the top centre; the Generals in a row beneath, evenly spaced, Calliope under SAM
  assert.ok(Math.abs(sc.core.x - layout.W / 2) < 1);
  for (const st of sc.stations) assert.ok(sc.core.y < st.box.top[0][1], `${st.id} sits below SAM`);
  const xs = sc.stations.map((s) => s.cx);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  gaps.forEach((g) => assert.ok(Math.abs(g - gaps[0]) < 1e-6));
  assert.ok(Math.abs(xs[2] - sc.core.x) < 1);
});

test('one worker figure per queued or running job, under its own General (Must 7)', () => {
  const sc = buildScene(fixture(), layout, { now: NOW });
  assert.equal(figuresOf(sc, 'hephaestus').length, 2, 'two running jobs = two figures');
  assert.equal(figuresOf(sc, 'prometheus').length, 1);
  assert.equal(figuresOf(sc, 'cerberus').length, 1, 'a queued job stands by on its pad');
  assert.equal(figuresOf(sc, 'cerberus')[0].active, false);
  assert.equal(figuresOf(sc, 'hermes').length, 0, 'an old failed job has left the floor');
  assert.equal(figuresOf(sc, 'calliope').length, 1, 'a job that failed just now shows, in red');
  assert.equal(figuresOf(sc, 'calliope')[0].failed, true);
  assert.deepEqual(figuresOf(sc, 'calliope')[0].col, BAD);
  assert.equal(figuresOf(sc, 'sam').length, 1, 'a job with no General shows under SAM (Must 17)');
  assert.deepEqual(figureCounts(fixture(), NOW), { hermes: 0, hephaestus: 2, calliope: 1, cerberus: 1, prometheus: 1, sam: 1 });
  // every General keeps at least the mockup's two pads; a busy one gets one pad per figure
  const padsUnder = (id: GeneralId) => {
    const st = sc.stations.find((s) => s.id === id)!;
    return sc.pads.filter((p) => Math.abs(p.box.top[0][0] - st.cx) < layout.opts.spacing * layout.s * 0.5).length;
  };
  assert.equal(padsUnder('hermes'), 2);
});

test('more than two jobs under one General spread across more pads, all inside its column', () => {
  const st = fixture();
  st.generals.hermes = { idle: false, workers: ['a', 'b', 'c', 'd'].map((id) => worker('job-' + id, 'hermes', 'running')) };
  const sc = buildScene(st, layout, { now: NOW });
  const figs = figuresOf(sc, 'hermes');
  assert.equal(figs.length, 4);
  const cx = sc.stations[0].cx, half = layout.opts.spacing * layout.s * 0.5;
  figs.forEach((f) => assert.ok(Math.abs(f.x - cx) < half));
  assert.equal(new Set(figs.map((f) => Math.round(f.x))).size, 4, 'no two figures on one pad');
});

test('the bust slot carries idle: true for an idle General and idle: false for a working one (the T8 seam)', () => {
  const sc = buildScene(fixture(), layout, { now: NOW });
  const slot = (id: GeneralId) => sc.stations.find((s) => s.id === id)!.bustSlot;
  assert.equal(slot('hermes').idle, true);
  assert.equal(slot('cerberus').idle, true, 'queued only is still idle');
  assert.equal(slot('hephaestus').idle, false);
  assert.equal(slot('prometheus').idle, false);
  assert.equal(slot('hermes').level, 0.4);
  assert.equal(slot('hephaestus').level, 1);
  assert.ok(slot('hephaestus').heightPx > 0 && slot('hephaestus').heightPx <= layout.zeusU * layout.s * 0.7 + 1e-6);
});

test('an idle General has no traffic on its link; a working one does (Must 10)', () => {
  const st = fixture();
  const sc = buildScene(st, layout, { now: NOW });
  const route = (id: GeneralId) => samLink(layout, layout.GU[id]);
  const onRoute = (id: GeneralId) => sc.pulses.filter((p) => p.curve[3][0] === route(id)[3][0] && p.curve[0][1] === route(id)[0][1]);
  assert.equal(onRoute('hermes').length, 0);
  assert.equal(onRoute('cerberus').length, 0);
  assert.ok(onRoute('hephaestus').length > 0);
  assert.equal(sc.litLinks.filter((l) => l.curve[3][0] === route('hermes')[3][0] && l.curve[3][1] === route('hermes')[3][1]).length, 0);
});

test('stage pads light from real stages only; a job with no stage events lights none (Must 8, 17)', () => {
  const sc = buildScene(fixture(), layout, { now: NOW });
  const heph = sc.stations.find((s) => s.id === 'hephaestus')!;
  assert.deepEqual(heph.stagePads.map((p) => p.state), ['done', 'now', 'todo']);
  const prom = sc.stations.find((s) => s.id === 'prometheus')!;
  assert.ok(prom.stagePads.every((p) => p.state === 'off'));
  assert.deepEqual(heph.card.segs, ['done', 'now', '']);
});

test('each tower holds one slab per job verified today (Must 12)', () => {
  const sc = buildScene(fixture(), layout, { now: NOW });
  assert.deepEqual(sc.stations.map((s) => s.slabs.length), [6, 4, 0, 3, 2]);
  const busy = fixture();
  busy.towers.hermes = 25;
  const sc2 = buildScene(busy, layout, { now: NOW });
  assert.equal(sc2.stations[0].slabs.length, 25, 'a big day packs the slabs tighter, never drops one');
});

test('reduced motion: no travelling lights, no bob, a still state', () => {
  const sc = buildScene(fixture(), layout, { now: NOW, reduced: true });
  assert.equal(sc.pulses.length, 0);
  assert.equal(sc.core.bob, 0);
  sc.figures.forEach((f) => { assert.equal(f.spawnK, 1); assert.equal(f.vis, 1); });
  // the same frame at another instant is identical
  const later = buildScene(fixture(), layout, { now: NOW + 1234, reduced: true });
  assert.deepEqual(later.stations.map((s) => s.stagePads.map((p) => p.fill)), sc.stations.map((s) => s.stagePads.map((p) => p.fill)));
});

test('the first poll plays nothing; a new dispatch flare runs the pulse to its General once (Must 9)', () => {
  const a = fixture();
  a.dispatchFlares = [{ jobId: 'job-build', at: iso(4000) }];
  const fx0 = diffFloor(null, a, NOW, emptyFx());
  assert.equal(fx0.dispatches.length, 0, 'opening the page is not a dispatch');

  const b = fixture();
  b.generals.hermes = { idle: false, workers: [worker('job-new', 'hermes', 'running', { startedAt: iso(500) })] };
  b.dispatchFlares = [...a.dispatchFlares, { jobId: 'job-new', at: iso(500) }];
  const fx1 = diffFloor(a, b, NOW, fx0);
  assert.deepEqual(fx1.dispatches.map((d) => [d.jobId, d.owner]), [['job-new', 'hermes']]);
  assert.equal(fx1.spawns['job-new'], NOW + FX.DISPATCH, 'the figure spawns once the pulse arrives');
  const mid = buildScene(b, layout, { now: NOW + FX.DISPATCH / 2, fx: fx1 });
  const route = samLink(layout, layout.GU.hermes);
  assert.ok(mid.pulses.some((p) => p.curve[3][0] === route[3][0] && p.col === MIST && !p.back));
  assert.ok(mid.zeusSlot.flare);
  // the same flare in the next poll does not fire again
  const fx2 = diffFloor(b, b, NOW + 3000, fx1);
  assert.equal(fx2.dispatches.filter((d) => d.at === NOW + 3000).length, 0);
  // nor under reduced motion is anything drawn
  assert.equal(buildScene(b, layout, { now: NOW + 500, fx: fx1, reduced: true }).pulses.length, 0);
});

test('a job ending exit 0 returns in teal and drops one slab; non-zero shows red and adds none (Must 11, 12)', () => {
  const a = fixture();
  const b = fixture();
  b.generals.prometheus = { idle: true, workers: [] }; // job-bench reached done: the reader drops it
  b.towers.prometheus = 3;
  b.generals.hephaestus.workers[1] = { ...b.generals.hephaestus.workers[1], status: 'failed', endedAt: iso(0) };
  const fx = diffFloor(a, b, NOW, emptyFx());
  const ok = fx.ends.find((e) => e.jobId === 'job-bench')!;
  const bad = fx.ends.find((e) => e.jobId === 'job-second')!;
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
  assert.deepEqual(fx.slabDrops.prometheus, { at: NOW + FX.RETURN + FX.VERIFY, count: 1 });
  assert.equal(fx.slabDrops.hephaestus, undefined);
  assert.equal(fx.idleFlips.prometheus, NOW);

  const during = buildScene(b, layout, { now: NOW + FX.RETURN + FX.VERIFY / 2, fx });
  const promRoute = samLink(layout, layout.GU.prometheus), hephRoute = samLink(layout, layout.GU.hephaestus);
  const back = (r: typeof promRoute) => during.pulses.filter((p) => p.back && p.curve[3][0] === r[3][0] && p.curve[0][1] === r[0][1]);
  assert.ok(back(promRoute).some((p) => p.col === TEAL), 'proof returns to SAM in teal');
  assert.ok(back(hephRoute).some((p) => p.col === BAD), 'the failure returns in status red');
  // slab waits for the proof, then lands; the failed General's tower is unchanged
  assert.equal(during.stations[4].slabs.length, 2);
  const after = buildScene(b, layout, { now: NOW + FX.RETURN + FX.VERIFY + FX.DROP + 10, fx });
  assert.equal(after.stations[4].slabs.length, 3);
  assert.equal(after.stations[1].slabs.length, 4);
  assert.equal(figuresOf(after, 'hephaestus').filter((f) => f.failed).length, 1);
});

test('hit test finds the General whose column was clicked, and nothing off the floor', () => {
  const cam = layout.home, view = { W: layout.W, H: layout.H, cam };
  for (const g of GENERALS) {
    const x = toX(view, layout.GU[g.id]);
    const sc = buildScene(fixture(), layout, { now: NOW });
    const st = sc.stations.find((s) => s.id === g.id)!;
    assert.equal(hitGeneral(layout, cam, x, st.box.top[0][1] + 5), g.id);
  }
  assert.equal(hitGeneral(layout, cam, -5, 10), null);
  assert.equal(hitGeneral(layout, cam, layout.W / 2, 2), null, 'SAM is not a General');
});

test('laptop layout keeps the same proportions and fits the canvas; the palette has no purple or violet', () => {
  for (const [w, h, o] of [[1920 - 760, 1080 - 400, DESKTOP_OPTIONS], [944, 560, LAPTOP_OPTIONS], [700, 330, LAPTOP_OPTIONS]] as const) {
    const L = computeLayout(w, h, o);
    const sc = buildScene(fixture(), L, { now: NOW });
    assert.ok(sc.stations[0].card.x >= 0 && sc.stations[4].card.x + sc.stations[4].card.w <= w, `cards fit at ${w}x${h}`);
    assert.ok(sc.plinth.top.top[0][1] > 0, `SAM fits at ${w}x${h}`);
  }
  // hue of every palette colour sits in the green-teal band (no purple, violet or magenta)
  for (const c of [CORE, ACC, EDGE, DEEP, TEAL, MIST]) {
    const [r, g, b] = c;
    assert.ok(g >= r && g >= b, `${c} is green-led`);
  }
});
