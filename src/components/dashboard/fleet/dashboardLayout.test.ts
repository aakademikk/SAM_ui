/**
 * SAM — dashboardLayout.test: the fleet dashboard's breakpoints and its
 * one-open-panel state (T11).
 *
 * The test harness compiles `*.test.ts` only and has no DOM, so the ticket's
 * `FleetDashboardShell.test.tsx` is this headless test of the pure layout
 * and panel logic the shell is built on, plus `summariseGeneral` from
 * `GeneralDetailPanel`.
 *
 * Breakpoints are the design source's `e-hybrid.html` media queries: the
 * drawer at `(min-width:820px) and (max-width:1600px)` or
 * `(min-width:820px) and (max-height:800px)`; Job detail and Fleet together
 * in the drawer at `(min-width:820px) and (max-width:1600px) and
 * (min-height:820px)`; the compact full layout at `(max-width:1700px)` or
 * `(max-height:980px)`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';

// House rule: a fresh HOME before importing anything under test (nothing here reads files, but the rule is cheap).
process.env.HOME = fs.mkdtempSync(`${os.tmpdir()}/dashlayout-home-`);

import {
  COMPACT_QUERY, DRAWER_QUERY, DRAWER_TABS, DRAWER_TALL_QUERY, INITIAL_PANEL_STATE, dashboardLayout, panelReducer,
} from './dashboardLayout.js';
import { summariseGeneral } from './GeneralDetailPanel.js';
import { LAPTOP_QUERY } from '../../floor/floorRender.js';
import type { FloorState, FloorWorker } from '@/types/floor.js';
import type { FleetPersonaJob } from '@/types/fleet.js';

test('the mockup sizes get the mockup layouts', () => {
  // 1920x1080: the recorded desktop layout, no drawer, not compact
  const d = dashboardLayout(1920, 1080);
  assert.equal(d.mode, 'full');
  assert.equal(d.compact, false);
  assert.equal(d.floorVariant, 'desktop');

  // Colin's small laptops: the drawer, Job tab open by default
  for (const [w, h] of [[1536, 730], [1366, 680], [1280, 650]] as const) {
    const l = dashboardLayout(w, h);
    assert.equal(l.mode, 'drawer', `${w}x${h} folds into the drawer`);
    assert.equal(l.defaultTab, 'detail', `${w}x${h} opens on the Job tab`);
    assert.equal(l.drawerTall, false, `${w}x${h} is too short for Job + Fleet together`);
    assert.equal(l.floorVariant, 'laptop');
    assert.deepEqual(l.visibleTabs, ['detail', 'fleet', 'jobs', 'events', 'spend', 'chat']);
  }

  // 1440x900: drawer, tall enough for Job detail and Fleet status together, so no Fleet tab button
  const tall = dashboardLayout(1440, 900);
  assert.equal(tall.mode, 'drawer');
  assert.equal(tall.drawerTall, true);
  assert.deepEqual(tall.visibleTabs, ['detail', 'jobs', 'events', 'spend', 'chat']);
});

test('breakpoint edges match the media queries exactly', () => {
  // width: 1200 to 1600 inclusive is the drawer; 1601 is not (when tall enough)
  assert.equal(dashboardLayout(1200, 1000).mode, 'drawer');
  assert.equal(dashboardLayout(1600, 1000).mode, 'drawer');
  assert.equal(dashboardLayout(1601, 1000).mode, 'full');
  // height: 800 or under is the drawer even on a wide screen; 801 is not
  assert.equal(dashboardLayout(1920, 800).mode, 'drawer');
  assert.equal(dashboardLayout(1920, 801).mode, 'full');
  assert.equal(dashboardLayout(1920, 801).compact, true, 'a wide but short desktop gets the compact columns');
  // taller-laptop sub-breakpoint: min-height 820
  assert.equal(dashboardLayout(1440, 819).drawerTall, false);
  assert.equal(dashboardLayout(1440, 820).drawerTall, true);
  assert.equal(dashboardLayout(1920, 1200).drawerTall, false, 'no drawer, so never drawer-tall');
  // compact full layout: up to 1700 wide or 980 tall
  assert.equal(dashboardLayout(1700, 1080).mode, 'full');
  assert.equal(dashboardLayout(1700, 1080).compact, true);
  assert.equal(dashboardLayout(1701, 981).compact, false);
  // under 820 wide is the phone's (T13); never the drawer
  const phone = dashboardLayout(412, 915);
  assert.equal(phone.phone, true);
  assert.notEqual(phone.mode, 'drawer');
  assert.equal(dashboardLayout(900, 500, { coarse: true }).phone, true, 'a phone on its side');
  assert.equal(dashboardLayout(900, 500).phone, false, 'a short window on a mouse is a laptop');
});

test('the CSS uses the mockup media queries verbatim', () => {
  assert.equal(DRAWER_QUERY, LAPTOP_QUERY, 'the drawer and the floor laptop scene share one query');
  assert.equal(DRAWER_QUERY, '(min-width:820px) and (max-width:1600px),(min-width:820px) and (max-height:800px)');
  assert.equal(DRAWER_TALL_QUERY, '(min-width:820px) and (max-width:1600px) and (min-height:820px)');
  assert.equal(COMPACT_QUERY, '(max-width:1700px),(max-height:980px)');
  assert.deepEqual(DRAWER_TABS.map((t) => t.label), ['Job', 'Fleet', 'Jobs', 'Events', 'Spend', 'Chat']);
});

test('one open panel: a General opens, Esc/Back/empty floor/a tab closes it', () => {
  let s = INITIAL_PANEL_STATE;
  assert.deepEqual(s, { tab: 'detail', open: null });

  s = panelReducer(s, { type: 'floorClick', hit: 'hephaestus' });
  assert.deepEqual(s.open, { kind: 'general', id: 'hephaestus' });
  assert.equal(s.tab, 'detail', 'the drawer tab is kept underneath');

  const same = panelReducer(s, { type: 'openGeneral', id: 'hephaestus' });
  assert.equal(same, s, 'opening the open General again changes nothing');

  s = panelReducer(s, { type: 'openGeneral', id: 'cerberus' });
  assert.deepEqual(s.open, { kind: 'general', id: 'cerberus' }, 'another General swaps the detail');

  assert.equal(panelReducer(s, { type: 'close' }).open, null, 'Esc or Back');
  assert.equal(panelReducer(s, { type: 'floorClick', hit: null }).open, null, 'a click on empty floor');

  const tabbed = panelReducer(s, { type: 'tab', tab: 'events' });
  assert.deepEqual(tabbed, { tab: 'events', open: null }, 'picking a tab closes the detail and shows the tab');

  const closedAgain = panelReducer(INITIAL_PANEL_STATE, { type: 'close' });
  assert.equal(closedAgain, INITIAL_PANEL_STATE, 'closing with nothing open is a no-op');
});

test('T18: the Schedule panel and a General detail never stack', () => {
  let s = INITIAL_PANEL_STATE;

  s = panelReducer(s, { type: 'openSchedule' });
  assert.deepEqual(s.open, { kind: 'schedule' }, 'the ring opens the Schedule panel');

  const same = panelReducer(s, { type: 'openSchedule' });
  assert.equal(same, s, 'opening the open Schedule panel again changes nothing');

  s = panelReducer(s, { type: 'openGeneral', id: 'hermes' });
  assert.deepEqual(s.open, { kind: 'general', id: 'hermes' }, 'opening a General closes the Schedule panel first');

  s = panelReducer(s, { type: 'openSchedule' });
  assert.deepEqual(s.open, { kind: 'schedule' }, 'and opening the ring again closes the General detail');

  assert.equal(panelReducer(s, { type: 'close' }).open, null, 'Esc or Back closes the Schedule panel too');
  assert.equal(panelReducer(s, { type: 'floorClick', hit: null }).open, null, 'a click on empty floor closes it too');

  const tabbed = panelReducer(s, { type: 'tab', tab: 'events' });
  assert.deepEqual(tabbed, { tab: 'events', open: null }, 'picking a tab closes the Schedule panel too');
});

function worker(jobId: string, status: FloorWorker['status']): FloorWorker {
  return {
    jobId, general: 'hephaestus', status, origin: 'chat', stages: null, stagesPlanned: null,
    elapsedMs: 1000, costUsd: null, startedAt: null, endedAt: null,
  };
}

function floor(): FloorState {
  const idle = { idle: true, workers: [] as FloorWorker[] };
  return {
    generals: {
      hermes: idle, calliope: idle, cerberus: idle, prometheus: idle,
      hephaestus: { idle: false, workers: [worker('live-1', 'running')] },
    },
    samWorkers: [],
    towers: { hermes: 0, hephaestus: 3, calliope: 0, cerberus: 0, prometheus: 0 },
    dispatchFlares: [],
  };
}

function job(id: string, createdAt: number, extra: Partial<FleetPersonaJob> = {}): FleetPersonaJob {
  return {
    id, command: `fleet:hephaestus (sonnet) — build ${id}`, status: 'exited', exitCode: 0,
    createdAt: new Date(createdAt).toISOString(), endedAt: new Date(createdAt + 60_000).toISOString(),
    model: 'sonnet', costUsd: 0.5, costBasis: 'computed', ...extra,
  };
}

test('summariseGeneral: live workers from the floor, spend and history from today only', () => {
  const now = new Date(2026, 9, 2, 15, 0, 0).getTime();
  const today = new Date(2026, 9, 2, 9, 0, 0).getTime();
  const yesterday = new Date(2026, 9, 1, 22, 0, 0).getTime();
  const jobs = [
    job('live-1', today + 5 * 3600_000, { status: 'running', exitCode: null, endedAt: null, costUsd: 0.25 }),
    job('done-1', today + 3600_000),
    job('fail-1', today, { exitCode: 1, costUsd: 0.1 }),
    job('old-1', yesterday, { costUsd: 9 }),
  ];

  const s = summariseGeneral(floor(), 'hephaestus', jobs, now);
  assert.equal(s.name, 'Hephaestus');
  assert.equal(s.role, 'Delivery');
  assert.equal(s.busy, true);
  assert.equal(s.workers.length, 1);
  assert.equal(s.verifiedToday, 3);
  assert.ok(s.spendToday !== null && Math.abs(s.spendToday - 0.85) < 1e-9, 'today only: 0.25 + 0.5 + 0.1');
  assert.equal(s.spendPartial, false);
  assert.deepEqual(s.earlier.map((j) => j.id), ['done-1', 'fail-1'], 'finished today, newest first, live job excluded');

  const idle = summariseGeneral(floor(), 'hermes', null, now);
  assert.equal(idle.busy, false);
  assert.equal(idle.spendToday, null, 'unknown until the jobs list loads, never a guessed 0');

  // a full page of today's jobs may not reach back to midnight: the spend is a floor, marked as such
  const full = Array.from({ length: 10 }, (_, i) => job(`j${i}`, today + i * 60_000));
  assert.equal(summariseGeneral(floor(), 'hephaestus', full, now).spendPartial, true);
});

test('T11: selectJob closes any panel and shows the Job tab', () => {
  const fromGeneral = panelReducer({ tab: 'events', open: { kind: 'general', id: 'hermes' } }, { type: 'selectJob' });
  assert.deepEqual(fromGeneral, { tab: 'detail', open: null }, 'a General open: closed, Job tab');
  const fromSchedule = panelReducer({ tab: 'detail', open: { kind: 'schedule' } }, { type: 'selectJob' });
  assert.deepEqual(fromSchedule, { tab: 'detail', open: null }, 'the Schedule panel open: closed');
  const fromTab = panelReducer({ tab: 'events', open: null }, { type: 'selectJob' });
  assert.deepEqual(fromTab, { tab: 'detail', open: null }, 'another tab: switches to Job');
  const already = { tab: 'detail', open: null } as const;
  assert.equal(panelReducer(already, { type: 'selectJob' }), already, 'already on Job, nothing open: same state object');
});
