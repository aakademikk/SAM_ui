/**
 * SAM — phoneView.test: the phone layout's pure half (T13, Must 6a to 6c).
 *
 * The layout gate (the mockup's media query plus its ?view= override), the
 * one-sheet-at-a-time state, the swipe-down decision, and the job in
 * flight's caption, lifecycle and stage timeline (real stages only, Must 17).
 * Also the phone hero's canvas labels from floorRender (e-phone.html
 * `labels`). No DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test.
process.env.HOME = tempDir('phoneview-home-');

import type { FloorState, FloorWorker, GeneralId } from '../../../types/floor.js';
import { DESKTOP_OPTIONS, PHONE_OPTIONS, buildScene, computeLayout, hitGeneral, phoneLabels, toX } from '../../floor/floorRender.js';
import { dashboardLayout } from './dashboardLayout.js';
import {
  PHONE_QUERY, chooseFleetView, findFloorWorker, heroCaption, lifecycleSteps, phoneSheetReducer, scrollBehaviorFor, sheetDragOffset, sheetReleaseCloses,
  stageTimeline, viewOverride,
} from './phoneView.js';

function worker(jobId: string, general: GeneralId | 'sam', status: FloorWorker['status'], extra: Partial<FloorWorker> = {}): FloorWorker {
  return {
    jobId, general, status, origin: 'chat', stages: null, stagesPlanned: null, elapsedMs: 60_000, costUsd: null,
    startedAt: null, endedAt: null, ...extra,
  };
}

function fixture(): FloorState {
  return {
    generals: {
      hermes: { idle: true, workers: [] },
      hephaestus: {
        idle: false,
        workers: [worker('j1', 'hephaestus', 'running', {
          stages: [{ name: 'Brief', state: 'done' }, { name: 'Build', state: 'now' }, { name: 'Proof', state: 'todo' }],
          stagesPlanned: ['Brief', 'Build', 'Proof'],
        })],
      },
      calliope: { idle: false, workers: [worker('j2', 'calliope', 'queued')] },
      cerberus: { idle: true, workers: [] },
      prometheus: { idle: true, workers: [] },
    },
    samWorkers: [],
    towers: { hermes: 0, hephaestus: 2, calliope: 0, cerberus: 0, prometheus: 0 },
    dispatchFlares: [],
  };
}

/* ---------- the gate ---------- */

test('the gate is the mockup query, with "under 560 px tall" as 559', () => {
  assert.equal(PHONE_QUERY, '(max-width:819px),(pointer:coarse) and (max-height:559px)');
  // the same edges in the layout helper the desktop shell uses
  assert.equal(dashboardLayout(819, 900).phone, true);
  assert.equal(dashboardLayout(820, 900).phone, false);
  assert.equal(dashboardLayout(915, 559, { coarse: true }).phone, true);
  assert.equal(dashboardLayout(915, 560, { coarse: true }).phone, false);
});

test('412x915 lands on the phone, 1920 on the desktop', () => {
  assert.equal(chooseFleetView('', dashboardLayout(412, 915).phone), 'phone');
  assert.equal(chooseFleetView('', dashboardLayout(390, 844).phone), 'phone');
  assert.equal(chooseFleetView('', dashboardLayout(1920, 1080).phone), 'desktop');
  assert.equal(chooseFleetView('', dashboardLayout(1280, 650).phone), 'desktop');
});

test('?view=phone and ?view=desktop override the query, as in the mockup', () => {
  assert.equal(chooseFleetView('?view=phone', false), 'phone');
  assert.equal(chooseFleetView('?demo=1&view=desktop', true), 'desktop');
  assert.equal(chooseFleetView('?view=desktop&x=1', true), 'desktop');
  assert.equal(viewOverride('?view=tablet'), null);
  assert.equal(viewOverride('?preview=phone'), null);
  assert.equal(viewOverride('?view=phoney'), null);
  assert.equal(chooseFleetView('?view=tablet', true), 'phone');
});

/* ---------- the sheet ---------- */

test('one sheet at a time: a General, the chat, or none', () => {
  let s = phoneSheetReducer(null, { type: 'openGeneral', id: 'hermes' });
  assert.deepEqual(s, { kind: 'general', id: 'hermes' });
  assert.equal(phoneSheetReducer(s, { type: 'openGeneral', id: 'hermes' }), s, 'reopening the same General is a no-op');
  s = phoneSheetReducer(s, { type: 'openGeneral', id: 'cerberus' });
  assert.deepEqual(s, { kind: 'general', id: 'cerberus' });
  s = phoneSheetReducer(s, { type: 'openChat' });
  assert.deepEqual(s, { kind: 'chat' }, 'the chat replaces the General');
  assert.equal(phoneSheetReducer(s, { type: 'close' }), null);
});

test('T18: the Schedule sheet and a General sheet never stack', () => {
  let s = phoneSheetReducer(null, { type: 'openSchedule' });
  assert.deepEqual(s, { kind: 'schedule' }, 'a tap on the ring opens the Schedule sheet');
  assert.equal(phoneSheetReducer(s, { type: 'openSchedule' }), s, 'reopening it is a no-op');
  s = phoneSheetReducer(s, { type: 'openGeneral', id: 'hermes' });
  assert.deepEqual(s, { kind: 'general', id: 'hermes' }, 'opening a General replaces the Schedule sheet');
  s = phoneSheetReducer(s, { type: 'openSchedule' });
  assert.deepEqual(s, { kind: 'schedule' }, 'and the ring replaces the General sheet right back');
  assert.equal(phoneSheetReducer(s, { type: 'close' }), null);
});

test('a hero tap on a General opens it; on empty floor it changes nothing', () => {
  const open = phoneSheetReducer(null, { type: 'heroTap', hit: 'prometheus' });
  assert.deepEqual(open, { kind: 'general', id: 'prometheus' });
  assert.equal(phoneSheetReducer(open, { type: 'heroTap', hit: null }), open);
  assert.equal(phoneSheetReducer(null, { type: 'heroTap', hit: null }), null);
});

test('swipe down: far enough or a quick flick closes, a nudge springs back, upwards never lifts', () => {
  assert.equal(sheetDragOffset(-40), 0);
  assert.equal(sheetDragOffset(55), 55);
  assert.equal(sheetReleaseCloses(120, 900), true, 'a long slow drag');
  assert.equal(sheetReleaseCloses(40, 50), true, 'a flick');
  assert.equal(sheetReleaseCloses(40, 400), false, 'a slow nudge');
  assert.equal(sheetReleaseCloses(10, 5), false, 'a tap-sized wobble');
  assert.equal(sheetReleaseCloses(-200, 50), false);
});

/* ---------- the job in flight ---------- */

test('the caption names the General and its lit stage, never an invented one', () => {
  const st = fixture();
  assert.equal(heroCaption(null, null), 'Connecting to the fleet');
  assert.equal(heroCaption(st, null), 'No jobs running');
  assert.equal(heroCaption(st, st.generals.hephaestus.workers[0]), 'Hephaestus · Build');
  assert.equal(heroCaption(st, worker('x', 'hermes', 'running')), 'Hermes · running');
  assert.equal(heroCaption(st, st.generals.calliope.workers[0]), 'SAM queued a job for Calliope');
  assert.equal(heroCaption(st, worker('y', 'sam', 'running')), 'SAM · running');
});

test('the lifecycle row follows the real status', () => {
  assert.deepEqual(lifecycleSteps('queued'), ['now', '', '', '', '']);
  assert.deepEqual(lifecycleSteps('running'), ['done', 'done', 'now', '', '']);
  assert.deepEqual(lifecycleSteps('verifying'), ['done', 'done', 'done', 'now', '']);
  assert.deepEqual(lifecycleSteps('done'), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(lifecycleSteps('failed'), ['done', 'done', 'done', '', 'bad']);
});

test('the stage timeline is the real stages, or none (Must 17)', () => {
  const t = stageTimeline(fixture().generals.hephaestus.workers[0]);
  assert.equal(t.summary, '1 of 3 stages');
  assert.deepEqual(t.stages?.map((s) => s.state), ['done', 'now', 'todo']);
  const none = stageTimeline(worker('old', 'sam', 'running', { stagesPlanned: ['A', 'B'] }));
  assert.equal(none.stages, null, 'planned stages alone are never shown as lit');
  assert.equal(none.summary, 'No stage events');
});

/* ---------- the hero's canvas labels (e-phone.html) ---------- */

test('phone hero: five labels under the Generals, with their real state, and SAM right of the ring', () => {
  for (const [W, H] of [[412, 372], [390, 372]]) {
    const layout = computeLayout(W, H, PHONE_OPTIONS);
    const scene = buildScene(fixture(), layout, { now: Date.parse('2026-10-02T12:00:00Z'), reduced: true });
    const pl = phoneLabels(scene, layout, fixture(), true);
    assert.equal(pl.generals.length, 5);
    const by = Object.fromEntries(pl.generals.map((g) => [g.id, g]));
    assert.equal(by.hephaestus.state, 'Running');
    assert.equal(by.hephaestus.busy, true);
    assert.equal(by.calliope.state, 'Queued');
    assert.equal(by.hermes.state, 'Idle');
    assert.equal(by.hermes.busy, false);
    // every label is inside the hero and the five run left to right
    const xs = pl.generals.map((g) => g.x);
    xs.forEach((x, i) => { assert.ok(x > 0 && x < W); if (i) assert.ok(x > xs[i - 1]); });
    pl.generals.forEach((g) => assert.ok(g.y > 0 && g.y + 24 < H, `label row inside the hero at ${W}`));
    // the SAM tag sits right of SAM's node and of the clock ring, and "ORCHESTRATOR" (8.5 px bold, about 70 px) fits
    assert.ok(pl.sam.x > toX(scene.view, 0));
    assert.ok(pl.sam.x >= scene.ringRight + 7);
    assert.ok(pl.sam.x + 72 < W, `SAM tag fits at ${W}`);
    // the phone fits the whole row (scale capped at 1) and taps still find each General
    assert.ok(layout.s <= 1);
    pl.generals.forEach((g) => assert.equal(hitGeneral(layout, layout.home, g.x, g.y + 10), g.id));
  }
});

test('the phone options are e-phone.html\'s, and leave the desktop options alone', () => {
  assert.equal(PHONE_OPTIONS.spacing, 170);
  assert.equal(PHONE_OPTIONS.zeusTop, 6);
  assert.equal(PHONE_OPTIONS.cardPx, 26);
  assert.equal(PHONE_OPTIONS.labelPx, 36);
  assert.equal(PHONE_OPTIONS.pad, 10);
  assert.equal(PHONE_OPTIONS.padTop, 16);
  assert.equal(PHONE_OPTIONS.zoom, 1.9);
  assert.equal(PHONE_OPTIONS.zoomCard, 1);
  assert.equal(PHONE_OPTIONS.maxScale, 1);
  assert.equal(PHONE_OPTIONS.numPx, 10.5);
  assert.equal(DESKTOP_OPTIONS.spacing, 230);
  assert.equal(DESKTOP_OPTIONS.padTop, 44);
});

test('T11: selectJob closes every sheet; scrolling is instant under reduced motion', () => {
  assert.equal(phoneSheetReducer({ kind: 'general', id: 'hermes' }, { type: 'selectJob' }), null, 'a General sheet closes');
  assert.equal(phoneSheetReducer({ kind: 'schedule' }, { type: 'selectJob' }), null, 'the Schedule sheet closes');
  assert.equal(phoneSheetReducer({ kind: 'chat' }, { type: 'selectJob' }), null, 'the chat sheet closes');
  assert.equal(phoneSheetReducer(null, { type: 'selectJob' }), null, 'nothing open stays nothing');
  assert.equal(scrollBehaviorFor(true), 'auto');
  assert.equal(scrollBehaviorFor(false), 'smooth');
});

test('a failed (red) job: found on the floor, captioned as failed, and its timeline steps render', () => {
  const st = fixture();
  const red = worker('jf', 'hermes', 'failed');
  st.generals.hermes = { idle: false, workers: [red] };
  const sam = worker('js', 'sam', 'failed');
  st.samWorkers = [sam];
  assert.equal(findFloorWorker(st, 'jf'), red, 'a General\'s failed worker');
  assert.equal(findFloorWorker(st, 'js'), sam, 'a SAM-owned worker');
  assert.equal(findFloorWorker(st, 'j1'), st.generals.hephaestus.workers[0], 'a running worker still resolves');
  assert.equal(findFloorWorker(st, 'nope'), null);
  assert.equal(findFloorWorker(st, null), null);
  assert.equal(findFloorWorker(null, 'jf'), null);
  assert.equal(heroCaption(st, red), 'Hermes · failed');
  assert.equal(heroCaption(st, sam), 'SAM · failed');
  assert.deepEqual(lifecycleSteps('failed'), ['done', 'done', 'done', '', 'bad']);
});
