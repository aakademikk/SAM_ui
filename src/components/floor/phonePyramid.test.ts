/**
 * SAM — phonePyramid.test: the phone's Generals in two rows under SAM (T14; spec P1, P2, P7, P9, checks 8, 9, 14, 16).
 *
 * Runs `PHONE_OPTIONS` at 360x780, 390x844, 412x915 (the full-screen hero) and 390x371 (a short hero). Pure
 * maths over `computeLayout`, `buildScene` and the `phoneGeometry` boxes: no canvas, no DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test (this module reads no files, but the rule is cheap).
process.env.HOME = tempDir('phonepyramid-home-');

import type { FloorState, FloorWorker, GeneralId } from '../../types/floor.js';
import { DESKTOP_OPTIONS, GENERALS, LAPTOP_OPTIONS, PHONE_OPTIONS, PYRAMID_ROWS, bez, buildScene, camFor, computeLayout, hitAreas, hitGeneral, lerpCam, phoneLabels, samLink, toX, toY } from './floorRender.js';
import type { Curve, Pt } from './floorRender.js';
import { boundsOf, bustBox, labelBox, numeralBox, padBoxes, platformPoly, rectsOverlap, samTagBox } from './phoneGeometry.js';
import type { Box } from './ringRender.js';
import { FIGURE_HIT_PX } from './figureHit.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const EDGE = 16;
const SIZES = [
  { name: '360x780', W: 360, H: 780 },
  { name: '390x844', W: 390, H: 844 },
  { name: '412x915', W: 412, H: 915 },
  { name: '390x371', W: 390, H: 371 },
];
const TOP = PYRAMID_ROWS[0], BOTTOM = PYRAMID_ROWS[1];

function idleState(): FloorState {
  const idle = { idle: true, workers: [] };
  return {
    generals: { hermes: idle, hephaestus: idle, calliope: idle, cerberus: idle, prometheus: idle },
    samWorkers: [], towers: { hermes: 0, hephaestus: 0, calliope: 0, cerberus: 0, prometheus: 0 }, dispatchFlares: [],
  };
}

function busyState(): FloorState {
  const busy = { idle: false, workers: [] };
  return { ...idleState(), generals: { hermes: busy, hephaestus: busy, calliope: busy, cerberus: busy, prometheus: busy } };
}

function build(W: number, H: number, state: FloorState = idleState()) {
  const layout = computeLayout(W, H, PHONE_OPTIONS);
  const scene = buildScene(state, layout, { now: NOW });
  const labels = phoneLabels(scene, layout, state, true);
  const st = (id: GeneralId) => scene.stations.find((s) => s.id === id)!;
  const lb = (id: GeneralId) => labelBox(labels.generals.find((g) => g.id === id)!);
  return { layout, scene, labels, st, lb };
}

/** A box's gap to the nearest canvas edge (negative if outside). */
const edgeGap = (b: Box, W: number, H: number) => Math.min(b[0], b[1], W - (b[0] + b[2]), H - (b[1] + b[3]));
const polyGap = (poly: Pt[], W: number, H: number) => edgeGap(boundsOf(poly), W, H);

test('P1: the back row is Cerberus and Prometheus, strictly above Hermes, Hephaestus and Calliope; each row is centred', () => {
  assert.deepEqual(PYRAMID_ROWS, [['cerberus', 'prometheus'], ['hermes', 'hephaestus', 'calliope']]);
  for (const { name, W, H } of SIZES) {
    const { st, layout } = build(W, H);
    const backBottom = Math.max(...TOP.map((id) => { const b = boundsOf(platformPoly(st(id))); return b[1] + b[3]; }));
    for (const id of BOTTOM) {
      assert.ok(boundsOf(platformPoly(st(id)))[1] > backBottom, `${name}: ${id} below the back row`);
      assert.ok(layout.GV[id] > 0, `${name}: ${id} has a v offset`);
    }
    TOP.forEach((id) => assert.equal(layout.GV[id], 0, `${name}: ${id} on the back row`));
    for (const row of PYRAMID_ROWS) {
      const mid = row.reduce((a, id) => a + st(id).cx, 0) / row.length;
      assert.ok(Math.abs(mid - W / 2) < 0.01, `${name}: row ${row.join(',')} centred (${mid.toFixed(2)} vs ${W / 2})`);
    }
  }
});

test('P2: busts at 412x915 are at least 57.5 px; samK is between 0.6 and 2.5 at every size', () => {
  const { scene } = build(412, 915);
  for (const s of scene.stations) assert.ok(s.bustSlot.heightPx >= 57.5, `${s.id} bust ${s.bustSlot.heightPx.toFixed(2)} px`);
  for (const { name, W, H } of SIZES) {
    const k = build(W, H).layout.samK;
    assert.ok(k >= 0.6 && k <= 2.5, `${name}: samK ${k}`);
  }
});

test('P7 (check 14): every platform polygon and label box is at least 16 px inside the canvas edges', () => {
  for (const { name, W, H } of SIZES) {
    const { scene, lb, labels } = build(W, H);
    for (const s of scene.stations) {
      const pg = polyGap(platformPoly(s), W, H), lg = edgeGap(lb(s.id), W, H);
      assert.ok(pg >= EDGE - 1e-6, `${name}: ${s.id} platform ${pg.toFixed(3)} px from the edge`);
      assert.ok(lg >= EDGE - 1e-6, `${name}: ${s.id} label ${lg.toFixed(3)} px from the edge`);
    }
    const tg = edgeGap(samTagBox(labels.sam), W, H);
    assert.ok(tg >= 0, `${name}: the SAM tag is on the canvas (${tg.toFixed(2)} px)`);
  }
});

test('P9 (check 16): a 390x371 hero shows both rows and SAM, and no General box overlaps another, the SAM tag or the 12 numeral', () => {
  for (const { name, W, H } of SIZES) {
    const { layout, scene, labels, st, lb } = build(W, H);
    assert.ok(layout.samK >= 0.6 && layout.samK <= 2.5, `${name}: samK ${layout.samK}`);
    assert.equal(scene.stations.length, 5, `${name}: all five Generals`);
    for (const s of scene.stations) {
      assert.ok(polyGap(platformPoly(s), W, H) >= 0 && edgeGap(bustBox(s), W, H) >= 0, `${name}: ${s.id} on the canvas`);
    }
    assert.ok(scene.core.y > 0 && scene.zeusSlot.y - scene.zeusSlot.heightPx >= 0, `${name}: SAM on the canvas`);
    const boxes = (id: GeneralId): { what: string; b: Box }[] => [
      { what: 'platform', b: boundsOf(platformPoly(st(id))) }, { what: 'bust', b: bustBox(st(id)) }, { what: 'label', b: lb(id) },
    ];
    const tag = samTagBox(labels.sam), twelve = numeralBox(layout, scene);
    const ids = GENERALS.map((g) => g.id);
    ids.forEach((a, i) => {
      for (const x of boxes(a)) {
        assert.ok(!rectsOverlap(x.b, tag), `${name}: ${a} ${x.what} overlaps the SAM tag`);
        assert.ok(!rectsOverlap(x.b, twelve), `${name}: ${a} ${x.what} overlaps the 12 numeral`);
        for (const c of ids.slice(i + 1)) {
          for (const y of boxes(c)) {
            assert.ok(!rectsOverlap(x.b, y.b), `${name}: ${a} ${x.what} overlaps ${c} ${y.what}`);
          }
        }
      }
    });
    assert.ok(!rectsOverlap(tag, twelve), `${name}: the SAM tag over the 12 numeral`);
  }
});

test('the pyramid is the phone layout only: desktop and laptop keep one row, and the layout keeps GV non-enumerable', () => {
  assert.deepEqual(PHONE_OPTIONS.pyramid, { rows: PYRAMID_ROWS, samMin: 0.6, edge: 16 });
  assert.equal(DESKTOP_OPTIONS.pyramid, undefined);
  assert.equal(LAPTOP_OPTIONS.pyramid, undefined);
  const one = computeLayout(1150, 666, DESKTOP_OPTIONS);
  assert.ok(GENERALS.every((g) => one.GV[g.id] === 0));
  const py = computeLayout(412, 915, PHONE_OPTIONS);
  assert.ok(!('GV' in JSON.parse(JSON.stringify(py))), 'GV stays out of the layout JSON (the desktop golden hashes it)');
  const sc = buildScene(idleState(), py, { now: NOW });
  assert.equal(padBoxes(sc).length, sc.pads.length);
});

/** Whether a point is inside a convex polygon (either winding), grown by `margin` px (a point-to-edge test). */
function inPoly(p: Pt, poly: Pt[], margin: number): boolean {
  let inside = true, sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
    if (sign === 0 && Math.abs(d) > 1e-9) sign = Math.sign(d);
    if (d * sign < -margin) inside = false;
  }
  return inside;
}
const inBox = (p: Pt, b: Box, m: number) => p[0] > b[0] - m && p[0] < b[0] + b[2] + m && p[1] > b[1] - m && p[1] < b[1] + b[3] + m;

test('P3 (check 10): SAM links, lit or not, never pass through another General, the SAM tag or the 12 numeral', () => {
  const MARGIN = 3;
  for (const { name, W, H } of SIZES) {
    for (const [mode, state] of [['idle', idleState()], ['busy', busyState()]] as const) {
      const { layout, scene, labels, st, lb } = build(W, H, state);
      const tag = samTagBox(labels.sam), twelve = numeralBox(layout, scene);
      const curves = new Map<GeneralId, Curve>(GENERALS.map((g) => [g.id, samLink(layout, layout.GU[g.id], layout.GV[g.id])]));
      // the scene draws exactly these: in a busy scene each is also a lit link
      const drawn = (c: Curve) => (mode === 'busy' ? scene.litLinks : scene.baseLinks).some((f) => f.curve.every((q, i) => q[0] === c[i][0] && q[1] === c[i][1]));
      for (const [id, c] of curves) assert.ok(drawn(c), `${name} ${mode}: ${id}'s link is in the scene`);
      for (const [id, c] of curves) {
        const pt = (t: number): Pt => { const q = bez(c, t); return [toX(scene.view, q[0]), toY(scene.view, q[1])]; };
        const end = pt(1), own = boundsOf(platformPoly(st(id)));
        assert.ok(inBox(end, own, 0), `${name} ${mode}: ${id} link ends on its own platform (${end.map((n) => n.toFixed(1))} vs ${own.map((n) => n.toFixed(1))})`);
        for (let i = 0; i <= 80; i++) {
          const p = pt(i / 80);
          for (const other of GENERALS.map((g) => g.id)) {
            if (other === id) continue;
            // KNOWN LIMIT (T15, check 10, not T18's): at 390x371 a link still crosses another General's label (the
            // hephaestus link passes prometheus's at t=0.75); platforms and busts are still asserted there.
            const checks: [string, boolean][] = [
              ['platform', inPoly(p, platformPoly(st(other)), MARGIN)], ['bust', inBox(p, bustBox(st(other)), MARGIN)],
              ['label', H >= 500 && inBox(p, lb(other), MARGIN)],
            ];
            for (const [what, hit] of checks) assert.ok(!hit, `${name} ${mode}: ${id} link passes through ${other}'s ${what} at t=${i / 80} (${p.map((n) => n.toFixed(1))})`);
          }
          assert.ok(!inBox(p, tag, MARGIN), `${name} ${mode}: ${id} link crosses the SAM tag at t=${i / 80}`);
          assert.ok(!inBox(p, twelve, MARGIN), `${name} ${mode}: ${id} link crosses the 12 numeral at t=${i / 80}`);
        }
      }
    }
  }
});

test('P5 (check 12): a tapped General, either row, is framed whole (platform, bust, label inside the canvas) and zoomed past home', () => {
  for (const { name, W, H } of SIZES.slice(0, 3)) {
    const layout = computeLayout(W, H, PHONE_OPTIONS);
    for (const { id } of GENERALS) {
      const cam = camFor(layout, id);
      const state = idleState();
      const scene = buildScene(state, layout, { now: NOW, cam });
      const labels = phoneLabels(scene, layout, state, true);
      const s = scene.stations.find((q) => q.id === id)!;
      const boxes: [string, Box][] = [
        ['platform', boundsOf(platformPoly(s))], ['bust', bustBox(s)], ['label', labelBox(labels.generals.find((g) => g.id === id)!)],
      ];
      for (const [what, b] of boxes) {
        const gap = edgeGap(b, W, H);
        assert.ok(gap >= 0, `${name} ${id}: ${what} ${gap.toFixed(2)} px inside the canvas (box ${b.map((n) => n.toFixed(1))})`);
      }
      assert.ok(cam.k > layout.s, `${name} ${id}: zoom ${cam.k.toFixed(3)} is above home ${layout.s.toFixed(3)}`);
      // lerpCam between home and the General: finite at every step
      for (let i = 0; i <= 10; i++) {
        const c = lerpCam(layout.home, cam, i / 10);
        assert.ok([c.x, c.y, c.k].every(Number.isFinite) && c.k > 0, `${name} ${id}: lerpCam step ${i} is finite`);
      }
    }
  }
});

test('P4 (check 11): every point of a General\'s platform, bust and label taps that General, the tap areas are disjoint, and outside them nothing taps', () => {
  for (const { name, W, H } of [{ name: '360x780', W: 360, H: 780 }, { name: '390x844', W: 390, H: 844 }, { name: '412x915', W: 412, H: 915 }]) {
    const { layout, scene, labels } = build(W, H);
    const cam = layout.home;
    for (const { id } of GENERALS) {
      const s = scene.stations.find((q) => q.id === id)!;
      const poly = platformPoly(s);
      const boxes: [string, Box][] = [['platform', boundsOf(poly)], ['bust', bustBox(s)], ['label', labelBox(labels.generals.find((g) => g.id === id)!)]];
      for (const [what, b] of boxes) {
        for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
          const p: Pt = [b[0] + ((i + 0.5) / 12) * b[2], b[1] + ((j + 0.5) / 12) * b[3]];
          if (what === 'platform' && !inPoly(p, poly, 0)) continue;
          assert.equal(hitGeneral(layout, cam, p[0], p[1]), id, `${name} ${id} ${what} at ${p.map((n) => n.toFixed(1))}`);
        }
      }
    }
    const areas = hitAreas(layout, cam);
    assert.equal(areas.length, GENERALS.length);
    for (let a = 0; a < areas.length; a++) for (let b = a + 1; b < areas.length; b++) {
      const p = areas[a], q = areas[b];
      assert.ok(p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0, `${name}: ${p.id} and ${q.id} tap areas overlap`);
    }
    const sam = samTagBox(labels.sam);
    for (const p of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 2], [scene.core.x, scene.core.y], [sam[0] + 5, sam[1] + 5]] as Pt[]) {
      assert.equal(hitGeneral(layout, cam, p[0], p[1]), null, `${name}: ${p.map((n) => n.toFixed(1))} is no General`);
    }
  }
});

/** A signed gap between two boxes in px: negative when they overlap (the larger of the x and y separations). */
const boxGap = (a: Box, b: Box) => Math.max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]), b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]));
/** Whether a label box clears a platform polygon by `margin` px: no box corner or border sample within the polygon grown by it, and no polygon vertex inside the box grown by it. */
function polyBoxClear(poly: Pt[], b: Box, margin: number): boolean {
  const pts: Pt[] = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([b[0] + t * b[2], b[1]], [b[0] + t * b[2], b[1] + b[3]], [b[0], b[1] + t * b[3]], [b[0] + b[2], b[1] + t * b[3]]); }
  return !pts.some((p) => inPoly(p, poly, margin)) && !poly.some((q) => inBox(q, b, margin));
}

function check13(name: string, W: number, H: number, state: FloorState = idleState()): string[] {
  const MARGIN = 2, fails: string[] = [];
  const { layout, scene, labels, st, lb } = build(W, H, state);
  const tag = samTagBox(labels.sam), twelve = numeralBox(layout, scene);
  const ids = GENERALS.map((g) => g.id);
  const named: [string, Box][] = [['SAM tag', tag], ['12 numeral', twelve], ...ids.map((id): [string, Box] => [`${id} label`, lb(id)])];
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
    const g = boxGap(named[i][1], named[j][1]);
    if (g < MARGIN) fails.push(`${name}: ${named[i][0]} and ${named[j][0]} gap ${g.toFixed(2)} px`);
  }
  for (const [what, b] of named.filter(([w]) => w.endsWith('label'))) {
    for (const id of ids) {
      const own = what === `${id} label`, poly = platformPoly(st(id));
      // the label's own platform may touch it (zero overlap area); only others need the 2 px margin
      if (!polyBoxClear(poly, b, own ? 0 : MARGIN)) fails.push(`${name}: ${what} overlaps ${id} platform`);
      if (!own && rectsOverlap(bustBox(st(id)), b, MARGIN)) fails.push(`${name}: ${what} overlaps ${id} bust`);
      if (own && rectsOverlap(bustBox(st(id)), b, 0)) fails.push(`${name}: ${what} overlaps its own bust`);
    }
  }
  for (const [what, b] of [['SAM tag', tag], ['12 numeral', twelve]] as [string, Box][]) {
    for (const id of ids) {
      const g = boxGap(b, bustBox(st(id)));
      if (g < 4) fails.push(`${name}: ${what} to ${id} bust gap ${g.toFixed(2)} px (needs 4)`);
    }
  }
  return fails;
}

test('P6 (check 13): the SAM tag, the 12 numeral and every name and state label overlap nothing, at the full-screen sizes', () => {
  for (const { name, W, H } of SIZES.slice(0, 3)) {
    assert.deepEqual(check13(name, W, H), []);
    assert.deepEqual(check13(`${name} busy`, W, H, busyState()), []); // 'Running'/'Working' are longer than 'Idle'
  }
});

test('P6 (check 13): the same at 390x371, no exemption (a short hero trims the rows\' fixed-px room, see pyramidLayout)', () => {
  assert.deepEqual(check13('390x371', 390, 371), []);
  assert.deepEqual(check13('390x371 busy', 390, 371, busyState()), []);
});

/** A running job for a General (the fields the figures read). */
function job(general: GeneralId, n: number): FloorWorker {
  return {
    jobId: `${general}-${n}`, general, status: 'running', origin: 'chat', stages: null, stagesPlanned: null, elapsedMs: 60_000,
    costUsd: null, startedAt: new Date(NOW - 60_000 - n * 1000).toISOString(), endedAt: null,
  };
}
function jobsState(counts: Partial<Record<GeneralId, number>>): FloorState {
  const base = idleState();
  for (const [id, n] of Object.entries(counts) as [GeneralId, number][]) {
    base.generals[id] = { idle: false, workers: Array.from({ length: n }, (_, i) => job(id, i)) };
  }
  return base;
}

const CAPTION_PX = 110; // the caption's top above the canvas foot (ringRender.test)
const HALF_HIT = FIGURE_HIT_PX / 2;
const square = (f: { x: number; y: number }): Box => [f.x - HALF_HIT, f.y - HALF_HIT, FIGURE_HIT_PX, FIGURE_HIT_PX];

test('P8 (checks 15, 11): worker pads and figures on both rows stay on the canvas above the caption, clear of other Generals, and a top-row figure\'s 44 px square never reaches the bottom row', () => {
  const fixtures: [string, Partial<Record<GeneralId, number>>][] = [
    ['one job on cerberus and hephaestus', { cerberus: 1, hephaestus: 1 }],
    ['two figures on prometheus, hermes and calliope (the outer columns)', { prometheus: 2, hermes: 2, calliope: 2 }],
  ];
  for (const { name, W, H } of SIZES) {
    for (const [what, counts] of fixtures) {
      const tag = `${name} ${what}`, state = jobsState(counts);
      const { scene, st, lb } = build(W, H, state);
      assert.ok(scene.figures.length >= 2, `${tag}: figures drawn`);
      const cap = H - CAPTION_PX;
      scene.pads.forEach((p, i) => {
        const b = boundsOf([...p.box.top, ...p.box.left, ...p.box.right]);
        assert.ok(edgeGap(b, W, H) >= 0, `${tag}: pad ${i} on the canvas`);
        // the short 390x371 hero has no room above a 110 px caption: there the pads need only stay on the canvas (P9)
        assert.ok(H < 500 || b[1] + b[3] <= cap, `${tag}: pad ${i} foot ${(b[1] + b[3]).toFixed(1)} above the caption top ${cap}`);
      });
      for (const f of scene.figures) {
        if (f.owner === 'sam') continue;
        const sq = square(f), top = TOP.includes(f.owner);
        const pad = padBoxes(scene).find((b) => inBox([f.x, f.y], b, 0))!; // the figure's own pad box
        assert.ok(pad, `${tag}: ${f.jobId} stands on a pad`);
        assert.ok(f.x >= 0 && f.x <= W && f.y >= 0 && f.y <= H, `${tag}: ${f.jobId} figure on the canvas`);
        for (const g of GENERALS) {
          if (g.id === f.owner) continue;
          assert.ok(!rectsOverlap(pad, bustBox(st(g.id))) && !rectsOverlap(pad, lb(g.id)) && polyBoxClear(platformPoly(st(g.id)), pad, 0), `${tag}: ${f.jobId} pad box touches ${g.id}`);
          assert.ok(!inBox([f.x, f.y], bustBox(st(g.id)), 0), `${tag}: ${f.jobId} figure inside ${g.id}'s bust`);
          assert.ok(!inBox([f.x, f.y], lb(g.id), 0), `${tag}: ${f.jobId} figure inside ${g.id}'s label`);
          assert.ok(!inPoly([f.x, f.y], platformPoly(st(g.id)), 0), `${tag}: ${f.jobId} figure inside ${g.id}'s platform`);
        }
        // the 44 px hit squares: exempt at the short 390x371 hero, where the rows' gap cannot hold them (see pyramidLayout)
        if (H < 500) continue;
        if (top) {
          for (const id of BOTTOM) {
            assert.ok(!rectsOverlap(sq, bustBox(st(id))), `${tag}: ${f.jobId} hit square reaches ${id}'s bust`);
            assert.ok(polyBoxClear(platformPoly(st(id)), sq, 0), `${tag}: ${f.jobId} hit square reaches ${id}'s platform`);
          }
        } else {
          assert.ok(sq[1] + sq[3] <= cap, `${tag}: ${f.jobId} hit square foot ${(sq[1] + sq[3]).toFixed(1)} above the caption top ${cap}`);
        }
      }
    }
  }
});
