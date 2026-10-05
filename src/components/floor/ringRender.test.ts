/**
 * SAM — ringRender.test: the clock ring's pure geometry (T17; check 27's shape half, check 31).
 *
 * For an invented schedule at the floor canvas sizes the dashboard gives at
 * 1920x1080, 1536x730, 1366x680, 1280x650 (desktop/laptop shell) and
 * 412x915, 390x844 (phone hero), measured in a browser on the T11/T13
 * shells: every two marks sit at least 8 px apart at 1920 and 6 px at the
 * others; weekly and weekday jobs are diamonds, hourly-or-faster jobs beads
 * on the inner track, daily jobs lines; a tick over 24 h away is dim and one
 * due today is not; nothing of the ring falls inside the SAM label. Plus the
 * firing rules (Must 24, 25) and reduced motion. No canvas, no DOM.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: a fresh HOME before importing anything under test (this module reads no files, but the rule is cheap).
process.env.HOME = tempDir('ringrender-home-');

import type { FloorState, ScheduleCadence, ScheduledJob } from '../../types/floor.js';
import {
  DESKTOP_OPTIONS, GENERALS, GEO, LAPTOP_OPTIONS, PHONE_OPTIONS, buildScene, computeLayout, phoneLabels, toY,
} from './floorRender.js';
import type { SceneOptions } from './floorRender.js';
import {
  RING, RING_MIN_GAP, beadInterval, buildRing, diffSchedule, emptyRingFx, jobRingState, ringClass, ringGeometry,
} from './ringRender.js';
import type { Box, RingModel, RingVariant } from './ringRender.js';

/* ---------- fixtures: invented, generic job names only ---------- */

// Wednesday 30 September 2026, 11:00 UTC; the ring reads the day in UTC here so the test is the same in any timezone.
const NOW = Date.parse('2026-09-30T11:00:00Z');
const DAY = 86_400_000, MIN = 60_000;
const utcClock = (ms: number) => ((((ms % DAY) + DAY) % DAY) / MIN);
const at = (hhmm: string, plusDays = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  let t = Date.parse('2026-09-30T00:00:00Z') + (h * 60 + m) * MIN;
  if (t <= NOW) t += DAY;
  return new Date(t + plusDays * DAY).toISOString();
};
const inMin = (n: number) => new Date(NOW + n * MIN).toISOString();

function job(id: string, cadence: ScheduleCadence, plain: string, nextRun: string | null, extra: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id, kind: 'timer', name: id, schedulePlain: plain, cadence, lastRun: new Date(NOW - 5 * 3600_000).toISOString(),
    lastResult: 'ok', nextRun, launchesFleetJob: false, ...extra,
  };
}

/** The mockup's demo schedule, in T16's shape (invented names), plus three cron entries that share 03:00. */
function schedule(): ScheduledJob[] {
  const cron = { kind: 'cron' as const, lastRun: 'not recorded', lastResult: 'not recorded' as const };
  return [
    job('keep-warm.timer', 'frequent', 'Every 15 min', inMin(12)),
    job('vault-commit.timer', 'frequent', 'Every 30 min', inMin(5)),
    job('quota-log.timer', 'frequent', 'Hourly', inMin(18)),
    job('repo-check.timer', 'frequent', 'Hourly', inMin(52)),
    job('delegation-check.timer', 'hours', 'Every 4 hours', at('13:45')),
    job('dependency-scan.timer', 'weekly', 'Wednesdays at 11:20', at('11:20')),
    job('outreach-send.timer', 'weekday', 'Weekdays at 16:30', at('16:30')),
    job('graph-rebuild.timer', 'daily', 'Daily at 21:00', at('21:00')),
    job('nightly-backup.timer', 'daily', 'Daily at 22:30', at('22:30')),
    job('daily-fold.timer', 'daily', 'Daily at 23:30', at('23:30')),
    job('log-rotate.timer', 'daily', 'Daily at 00:00', at('00:00')),
    job('lead-sweep.timer', 'daily', 'Daily at 06:15', at('06:15'), { lastResult: 'failed' }),
    job('morning-brief.timer', 'daily', 'Daily at 07:00', at('07:00')),
    job('news-digest.timer', 'weekly', 'Mondays at 08:30', at('08:30', 4)),
    job('cron-1111aaaa', 'daily', 'Daily at 03:00', at('03:00'), cron),
    job('cron-2222bbbb', 'daily', 'Daily at 03:00', at('03:00'), cron),
    job('cron-3333cccc', 'daily', 'Daily at 03:00', at('03:00'), cron),
  ];
}

function floorState(): FloorState {
  const idle = { idle: true, workers: [] };
  return {
    generals: { hermes: idle, hephaestus: idle, calliope: idle, cerberus: idle, prometheus: idle },
    samWorkers: [], towers: { hermes: 0, hephaestus: 0, calliope: 0, cerberus: 0, prometheus: 0 }, dispatchFlares: [],
  };
}

/** The floor canvas's size at each viewport (the hero, measured in the shells), its scene options and spacing floor. */
const SIZES: { name: string; W: number; H: number; opts: SceneOptions; variant: RingVariant }[] = [
  { name: '1920x1080', W: 1150, H: 666, opts: DESKTOP_OPTIONS, variant: 'desktop' },
  { name: '1536x730', W: 1166, H: 596, opts: LAPTOP_OPTIONS, variant: 'laptop' },
  { name: '1366x680', W: 996, H: 546, opts: LAPTOP_OPTIONS, variant: 'laptop' },
  { name: '1280x650', W: 910, H: 516, opts: LAPTOP_OPTIONS, variant: 'laptop' },
  { name: '412x915', W: 412, H: 371, opts: PHONE_OPTIONS, variant: 'phone' },
  { name: '390x844', W: 390, H: 371, opts: PHONE_OPTIONS, variant: 'phone' },
  // the phone hero has been full screen (100dvh) since 2026-10-03: the whole viewport is the canvas
  { name: '390x844 full', W: 390, H: 844, opts: PHONE_OPTIONS, variant: 'phone' },
  { name: '412x915 full', W: 412, H: 915, opts: PHONE_OPTIONS, variant: 'phone' },
  { name: '360x780 full', W: 360, H: 780, opts: PHONE_OPTIONS, variant: 'phone' },
];

function ringAt(size: (typeof SIZES)[number], jobs = schedule(), extra: Partial<Parameters<typeof buildRing>[2]> = {}) {
  const layout = computeLayout(size.W, size.H, size.opts);
  const geo = ringGeometry(layout, layout.home, true);
  const ring = buildRing(jobs, geo, { now: NOW, variant: size.variant, clock: utcClock, ...extra });
  return { layout, geo, ring };
}

/** The SAM label's box: the desktop tag (SAM / ORCHESTRATOR / state, 50 px tall) or the phone's two lines. */
function samLabelBox(size: (typeof SIZES)[number], layout: ReturnType<typeof computeLayout>): Box {
  const sc = buildScene(floorState(), layout, { now: NOW });
  if (size.variant === 'phone') {
    const s = phoneLabels(sc, layout, floorState(), true).sam;
    return [s.x, s.y - 14, 80, 27];
  }
  return [sc.samLabel.x, sc.samLabel.y, 130, 50];
}

const overlaps = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const gapOf = (r: RingModel) => {
  let min = Infinity;
  for (let i = 0; i < r.marks.length; i++) {
    for (let j = i + 1; j < r.marks.length; j++) {
      min = Math.min(min, Math.hypot(r.marks[i].xy[0] - r.marks[j].xy[0], r.marks[i].xy[1] - r.marks[j].xy[1]));
    }
  }
  return min;
};

/* ---------- spacing, shapes, dimming, the SAM label (check 31) ---------- */

for (const size of SIZES) {
  test(`${size.name}: every two marks at least ${RING_MIN_GAP[size.variant]} px apart, numerals clear, nothing under the SAM label`, () => {
    const { layout, geo, ring } = ringAt(size);
    assert.ok(ring.marks.length >= 14, 'every outer tick plus the beads');
    const min = gapOf(ring);
    assert.ok(min >= RING_MIN_GAP[size.variant], `closest two marks ${min.toFixed(2)} px`);
    // numerals: all four, not under the floor size at laptop and desktop, not over a mark or each other
    assert.deepEqual(geo.nums.map((n) => n.t), ['00', '06', '12', '18']);
    if (size.variant !== 'phone') assert.ok(geo.numPx >= 11);
    geo.nums.forEach((n, i) => {
      ring.marks.forEach((m) => assert.ok(!overlaps(n.r, m.box), `${n.t} over ${m.id}`));
      geo.nums.forEach((o, j) => { if (j > i) assert.ok(!overlaps(n.r, o.r), `${n.t} over ${o.t}`); });
      assert.ok(n.r[1] >= 0 && n.r[0] >= 0 && n.r[0] + n.r[2] <= size.W, `${n.t} inside the canvas`);
    });
    // the SAM label: nothing of the ring inside its box, and the ring ends where buildScene left room for it
    const label = samLabelBox(size, layout);
    ring.marks.forEach((m) => assert.ok(!overlaps(m.box, label), `${m.id} under the SAM label`));
    geo.nums.forEach((n) => assert.ok(!overlaps(n.r, label), `${n.t} under the SAM label`));
    assert.ok(!overlaps(ring.extent, label), 'the ring extent is clear of the SAM label');
    const sc = buildScene(floorState(), layout, { now: NOW });
    assert.ok(Math.abs(geo.right - sc.ringRight) < 0.01, 'the 06 numeral ends where the scene reserved room for it');
  });
}

test('1920: the dial is about the polished mockup\'s size (270x156 px), 1280x650 about 194x112, the phone\'s is scaled with SAM (0.6 to 2.5 of 121x70)', () => {
  const want: Record<string, [number, number]> = { '1920x1080': [270, 156], '1280x650': [194, 112] };
  for (const size of SIZES.filter((s) => want[s.name])) {
    const { geo } = ringAt(size), [w, h] = want[size.name];
    assert.ok(Math.abs(2 * geo.rx - w) / w < 0.15, `${size.name} width ${(2 * geo.rx).toFixed(0)} vs ${w}`);
    assert.ok(Math.abs(2 * geo.ry - h) / h < 0.15, `${size.name} height ${(2 * geo.ry).toFixed(0)} vs ${h}`);
  }
  // the phone's pyramid gives SAM 0.6 to 2.5 of his old size (P2, P9): the dial is the mockup's 121x70 times that
  for (const size of SIZES.filter((s) => s.variant === 'phone')) {
    const { layout, geo } = ringAt(size);
    assert.ok(layout.samK >= 0.6 && layout.samK <= 2.5, `${size.name} samK ${layout.samK}`);
    const base = GEO.RR * 1.732 * layout.s;
    assert.ok(Math.abs(geo.rx - base * layout.samK) < 1e-6, `${size.name} width ${(2 * geo.rx).toFixed(0)} is the base dial times samK`);
    assert.ok(Math.abs(2 * geo.rx / 2 / geo.ry - 121 / 70) < 0.05, `${size.name} keeps the dial's 121:70 shape`);
  }
});

test('shapes: weekly and weekday jobs are diamonds, hourly-or-faster are beads on the inner track, daily jobs lines', () => {
  const { geo, ring } = ringAt(SIZES[0]);
  const tick = (id: string) => ring.ticks.find((t) => t.jobId === id)!;
  assert.equal(tick('dependency-scan.timer').shape, 'diamond');
  assert.equal(tick('outreach-send.timer').shape, 'diamond');
  assert.equal(tick('news-digest.timer').shape, 'diamond');
  assert.equal(tick('morning-brief.timer').shape, 'line');
  assert.equal(tick('delegation-check.timer').shape, 'line', 'every few hours is a line on the outer dial');
  for (const id of ['keep-warm.timer', 'vault-commit.timer', 'quota-log.timer', 'repo-check.timer']) {
    const t = tick(id), m = ring.marks.find((x) => x.id === t.markId)!;
    assert.equal(t.shape, 'bead');
    assert.equal(m.track, 'inner');
    const ex = (m.xy[0] - geo.cx) / geo.rx, ey = (m.xy[1] - geo.cy) / geo.ry;
    assert.ok(Math.abs(Math.hypot(ex, ey) - RING.INNER) < 1e-6, `${id} sits on the inner track`);
  }
  // one tick per job (check 27: timers plus cron entries), and the beads: 15-min four, 30-min two, the hourlies one each
  assert.equal(ring.ticks.length, schedule().length);
  assert.equal(ring.unplaced.length, 0);
  const beads = ring.marks.filter((m) => m.shape === 'bead');
  assert.equal(beads.length, 8, 'the mockup\'s eight beads: :05 :12 :18 :27 :35 :42 :52 :57');
  assert.equal(ringClass('weekday'), 'nondaily');
  assert.equal(ringClass('other'), 'nondaily');
  assert.equal(beadInterval({ schedulePlain: 'Every 15 min' }), 15);
  assert.equal(beadInterval({ schedulePlain: 'Every minute' }), 1);
  assert.equal(beadInterval({ schedulePlain: 'Hourly' }), 60);
});

test('a tick whose next run is over 24 h away is dim; one due today is not', () => {
  const { ring } = ringAt(SIZES[0]);
  const mark = (id: string) => ring.marks.find((m) => m.id === id)!;
  assert.equal(mark('news-digest.timer').dim, true, 'Monday, five days off');
  assert.equal(mark('dependency-scan.timer').dim, false, 'due in 20 min');
  assert.equal(mark('morning-brief.timer').dim, false);
  // the same weekly scan a week away (it has just fired) is dim
  const after = schedule().map((j) => (j.id === 'dependency-scan.timer' ? { ...j, nextRun: at('11:20', 7) } : j));
  assert.equal(ringAt(SIZES[0], after).ring.marks.find((m) => m.id === 'dependency-scan.timer')!.dim, true);
});

test('crowded times: ten daily jobs at one minute still get ten ticks, eased apart to the spacing floor at every size', () => {
  const crowd = [...schedule(), ...Array.from({ length: 10 }, (_, i) => job(`batch-${i}.timer`, 'daily', 'Daily at 02:00', at('02:00')))];
  const many = [...crowd, ...Array.from({ length: 4 }, (_, i) => job(`poll-${i}.timer`, 'frequent', 'Every 5 min', inMin(i)))];
  for (const size of SIZES) {
    // the smallest phone dial (SAM at his 0.6 floor, P9) is about 63 px wide: it holds eight 02:00 jobs above the floor, not ten
    const small = computeLayout(size.W, size.H, size.opts).samK < 0.7 && size.H < 400;
    const batch = small ? 8 : 10, jobsHere = small ? [...crowd.slice(0, crowd.length - 2), ...many.slice(crowd.length)] : many;
    const { ring } = ringAt(size, jobsHere);
    assert.equal(ring.ticks.length, jobsHere.length, `${size.name}: one tick per job`);
    assert.equal(ring.marks.filter((m) => m.id.startsWith('batch-')).length, batch);
    const min = gapOf(ring);
    assert.ok(min >= RING_MIN_GAP[size.variant], `${size.name}: closest two marks ${min.toFixed(2)} px`);
    // eased, not thrown: the batch stays round 02:00 (it shares the night with 00:00 and the three 03:00 cron entries)
    ring.marks.filter((m) => m.id.startsWith('batch-')).forEach((m) => {
      const hours = (m.angle / (Math.PI * 2)) * 24, off = Math.abs(((hours - 2 + 36) % 24) - 12);
      assert.ok(off < 4, `${m.id} at ${hours.toFixed(2)} h`);
    });
    // and the ticks well clear of the crowd do not move
    assert.ok(Math.abs(ring.marks.find((m) => m.id === 'delegation-check.timer')!.angle - (13.75 / 24) * Math.PI * 2) < 1e-9);
  }
});

/* ---------- firing, running, failed, reduced motion (Must 24, 25) ---------- */

test('a timer fires when its last run moves on: the light runs once round, the mark stays lit while running, then settles', () => {
  const before = schedule();
  assert.deepEqual(diffSchedule(null, before, NOW, emptyRingFx()).fires, {}, 'never on the first poll');
  const fired = before.map((j) => (j.id === 'morning-brief.timer' ? { ...j, lastRun: new Date(NOW).toISOString(), lastResult: 'running' as const } : j));
  const fx = diffSchedule(before, fired, NOW, emptyRingFx());
  assert.deepEqual(Object.keys(fx.fires), ['morning-brief.timer']);
  const brief = fired.find((j) => j.id === 'morning-brief.timer')!;
  const s0 = jobRingState(brief, fx, NOW + 400, false);
  assert.equal(s0.state, 'firing');
  assert.ok(s0.lap != null && s0.lap > 0 && s0.lap < 1);
  const lit = ringAt(SIZES[0], fired, { now: NOW + 400, fx }).ring;
  assert.equal(lit.laps.length, 1, 'one light on the ring');
  assert.ok(lit.marks.find((m) => m.id === 'morning-brief.timer')!.glow > 0.9);
  assert.equal(jobRingState(brief, fx, NOW + 30_000, false).state, 'running', 'still running: still lit');
  const ended = { ...brief, lastResult: 'ok' as const };
  assert.equal(jobRingState(ended, fx, NOW + 1_900, false).state, 'settling');
  assert.equal(jobRingState(ended, fx, NOW + 30_000, false).state, 'idle', 'ended: settled');
  // cron keeps no run record: it never fires
  const cronMoved = before.map((j) => (j.kind === 'cron' ? { ...j, nextRun: at('03:00', 1) } : j));
  assert.deepEqual(diffSchedule(before, cronMoved, NOW, emptyRingFx()).fires, {});
});

test('a failed last run is red until a good run; reduced motion: no light, lit if running, red if failed', () => {
  const jobs = schedule();
  const red = ringAt(SIZES[0], jobs).ring.marks.find((m) => m.id === 'lead-sweep.timer')!;
  assert.equal(red.state, 'failed');
  const fixed = jobs.map((j) => (j.id === 'lead-sweep.timer' ? { ...j, lastResult: 'ok' as const } : j));
  assert.equal(ringAt(SIZES[0], fixed).ring.marks.find((m) => m.id === 'lead-sweep.timer')!.state, 'idle');

  const running = jobs.map((j) => (j.id === 'nightly-backup.timer' ? { ...j, lastResult: 'running' as const, lastRun: new Date(NOW).toISOString() } : j));
  const fx = diffSchedule(jobs, running, NOW, emptyRingFx());
  const still = ringAt(SIZES[4], running, { now: NOW + 200, fx, reduced: true }).ring;
  assert.equal(still.laps.length, 0, 'no travelling light under reduced motion');
  const backup = still.marks.find((m) => m.id === 'nightly-backup.timer')!;
  assert.equal(backup.state, 'running');
  assert.ok(backup.glow > 0.5);
  assert.equal(still.marks.find((m) => m.id === 'lead-sweep.timer')!.state, 'failed');
});

/* ---------- the phone's full-screen hero: a bigger SAM up top, the Generals down by the caption (Colin, 2026-10-03) ---------- */

/** `.fp-cap` sits 84 px up and is about 26 px tall, so the caption's top is about 110 px above the hero's foot. */
const CAPTION_PX = 110;

for (const size of SIZES.filter((x) => x.name.endsWith(' full'))) {
  test(`${size.name}: Zeus 0.6 to 2.5 times his base size, centred in a ring scaled with him, both rows of Generals above the caption`, () => {
    const { W, H } = size;
    const layout = computeLayout(W, H, PHONE_OPTIONS);
    const sc = buildScene(floorState(), layout, { now: NOW });
    const geo = ringGeometry(layout, layout.home, true);
    const baseZeus = PHONE_OPTIONS.zeusU * layout.s;
    assert.ok(layout.samK >= 0.6 && layout.samK <= 2.5, `samK ${layout.samK}`);
    assert.ok(layout.GV.hermes > layout.GV.cerberus, 'the phone draws the pyramid: Cerberus on the back row, Hermes in front');
    assert.ok(Math.abs(sc.zeusSlot.heightPx - baseZeus * layout.samK) < 0.5, `Zeus ${sc.zeusSlot.heightPx.toFixed(0)} px is ${baseZeus.toFixed(0)} px times samK ${layout.samK}`);
    assert.ok(sc.zeusSlot.heightPx >= 0.6 * baseZeus && sc.zeusSlot.heightPx <= 2.5 * baseZeus);
    assert.ok(Math.abs(geo.rx - GEO.RR * 1.732 * layout.s * layout.samK) < 1e-6, 'the ring grows with Zeus');
    assert.ok(Math.abs(sc.zeusSlot.x - geo.cx) < 0.5, 'Zeus stays centred in the ring');
    // both rows count: `layout.bot` is one row's foot, so the front row's foot is its row offset (`GV`) plus that
    const foot = toY(sc.view, Math.max(...GENERALS.map((g) => layout.GV[g.id])) + layout.bot), cap = H - CAPTION_PX;
    assert.ok(foot <= cap - 8 && foot >= cap - 50, `the Generals' labels end at ${foot.toFixed(0)} px, the caption starts at ${cap}`);
    const pl = phoneLabels(sc, layout, floorState(), true).sam;
    assert.ok(pl.x >= 0 && pl.x + 80 <= W, `the SAM tag is on screen (x ${pl.x.toFixed(0)})`);
    const bustTop = Math.min(...sc.stations.map((st) => st.bustSlot.y - st.bustSlot.heightPx));
    const twelve = geo.nums[2].r;
    assert.ok(twelve[1] + twelve[3] < bustTop - 4, 'the 12 numeral clears the top row\'s busts');
    assert.ok(pl.y + 13 < bustTop - 4, 'the SAM tag clears the busts of both rows');
  });
}

test('desktop and laptop keep SAM at his old size (samK 1)', () => {
  assert.equal(computeLayout(1150, 666, DESKTOP_OPTIONS).samK, 1);
  assert.equal(computeLayout(996, 546, LAPTOP_OPTIONS).samK, 1);
  const short = computeLayout(390, 371, PHONE_OPTIONS);
  assert.ok(short.samK >= 0.6 && short.samK <= 2.5, `a short phone hero keeps SAM between 0.6 and 2.5 (samK ${short.samK})`);
  assert.ok(short.GV.hermes > short.GV.cerberus, 'a short phone hero still shows both rows (P9)');
  const sc = buildScene(floorState(), short, { now: NOW });
  const tops = sc.stations.map((st) => st.bustSlot.y - st.bustSlot.heightPx), tag = phoneLabels(sc, short, floorState(), true).sam;
  assert.ok(tag.y + 13 < Math.min(...tops) - 4 || tag.x > Math.max(...sc.stations.map((st) => st.bustSlot.x)), 'SAM clears the busts (P9)');
});

