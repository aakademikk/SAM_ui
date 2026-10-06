/**
 * SAM — floorGolden.test: the desktop and laptop floor must not change by one pixel (spec section 3).
 *
 * For six real sizes it hashes a canonical JSON of the layout, the cameras, the built scene (both motion modes,
 * two times) and the hit test over a grid. Any later floor change that moves a desktop or laptop number fails
 * here and names the size. Pure maths, no canvas, no clock, no randomness: the inputs are fixed.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test (this module reads no files, but the rule is cheap).
process.env.HOME = tempDir('floorgolden-home-');

import type { FloorState, FloorWorker, GeneralId } from '../../types/floor.js';
import {
  DESKTOP_OPTIONS, GENERALS, LAPTOP_OPTIONS, buildScene, camFor, computeLayout, hitGeneral,
} from './floorRender.js';
import type { SceneOptions } from './floorRender.js';

/*
 * Captured on 789589e (the untouched floor). Never edit except for a deliberate desktop change signed off by Colin.
 */
const GOLDEN: Record<string, string> = {
  'desktop 1150x666 (1920x1080 hero)': 'dcd1edba29f9c19dc527835d018c9a06da7478ad80ead312807c4dd895f4f11c',
  'desktop 1600x760': 'd1a3bfe3aad7ae0151bd6477f8a899312198818abfda4aeea407412c6a47db28',
  'laptop 1166x596': '7777ff9d5bd3c6359fab7706bdc0cd8c79c253abfa3ca9b346fcb7d15d9a5b8e',
  'laptop 996x546': 'f72451caf86269855c79b4f362c4fe3d46d5af3e985b17563381790babd30a6c',
  'laptop 910x516': '4a4073e6024957734bbc8e8b1b022623abf41f01cdc32290fcaa239dd746d2da',
  'laptop 800x500': '6ef47ff00f49f1c97023a410f1d251ee8a252a873dbe05b3f3c5e5abe4a7f0d3',
};

const SIZES: { name: string; W: number; H: number; opts: SceneOptions }[] = [
  { name: 'desktop 1150x666 (1920x1080 hero)', W: 1150, H: 666, opts: DESKTOP_OPTIONS },
  { name: 'desktop 1600x760', W: 1600, H: 760, opts: DESKTOP_OPTIONS },
  { name: 'laptop 1166x596', W: 1166, H: 596, opts: LAPTOP_OPTIONS },
  { name: 'laptop 996x546', W: 996, H: 546, opts: LAPTOP_OPTIONS },
  { name: 'laptop 910x516', W: 910, H: 516, opts: LAPTOP_OPTIONS },
  { name: 'laptop 800x500', W: 800, H: 500, opts: LAPTOP_OPTIONS },
];

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

/** JSON with every number rounded to 6 decimals (and -0 folded to 0); functions are dropped by JSON itself. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return String(v);
      const r = Math.round(v * 1e6) / 1e6;
      return r === 0 ? 0 : r;
    }
    return v;
  });
}

function sizeHash(W: number, H: number, opts: SceneOptions): string {
  const layout = computeLayout(W, H, opts);
  const state = fixture();
  const cams = [{ id: 'home', cam: camFor(layout, null) }, ...GENERALS.map((g) => ({ id: g.id, cam: camFor(layout, g.id) }))];

  const scenes = [
    { mode: 'motion t=0', input: { now: NOW, reduced: false } },
    { mode: 'motion t=1.37', input: { now: NOW + 1370, reduced: false } },
    { mode: 'reduced', input: { now: NOW, reduced: true } },
  ].map(({ mode, input }) => ({ mode, scene: buildScene(state, layout, input) }));

  // Each General's own camera too (the zoom): the scene built there, motion at t=0.
  const zoomed = cams.slice(1).map(({ id, cam }) => ({ id, scene: buildScene(state, layout, { now: NOW, reduced: false, cam }) }));

  // hitGeneral over a 24 x 16 grid across the canvas, at the home camera and at each General's camera.
  const hits = cams.map(({ id, cam }) => {
    const grid: (string | null)[] = [];
    for (let j = 0; j < 16; j++) for (let i = 0; i < 24; i++) grid.push(hitGeneral(layout, cam, ((i + 0.5) / 24) * W, ((j + 0.5) / 16) * H));
    return { id, grid };
  });

  const doc = { W, H, layout, cams, scenes, zoomed, hits };
  return createHash('sha256').update(canon(doc)).digest('hex');
}

for (const { name, W, H, opts } of SIZES) {
  test(`desktop/laptop golden: ${name}`, () => {
    const got = sizeHash(W, H, opts);
    assert.equal(
      got,
      GOLDEN[name],
      `floor scene changed at "${name}" (${W}x${H}); got ${got}. Desktop and laptop must not change (spec section 3).`,
    );
  });
}

test('the golden hash is deterministic (same inputs, same hash)', () => {
  const s = SIZES[0];
  assert.equal(sizeHash(s.W, s.H, s.opts), sizeHash(s.W, s.H, s.opts));
});
