/**
 * SAM — the clock ring's pure geometry (T17, Must 23, 24, 28).
 *
 * A 24-hour dial round SAM's top tier, ported from the polished mockup's
 * `e-scene.js` (`ringLayout`, `drawRing`, `drawLaps`, `drawNumerals`), fed by
 * `/api/fleet/schedule` (T16's `ScheduledJob[]`) instead of `window.ESCHED`.
 * Midnight at the back, 06:00 on the right, noon at the front, 18:00 on the
 * left; the numerals 00/06/12/18 sit outside the ticks (00 above Zeus's head,
 * who stands in the middle of the dial). A faint hand shows the time of day.
 *
 * - The outer dial has one tick per job that runs every few hours, daily,
 *   on weekdays or weekly, at its next run: a line for a job that runs every
 *   day (or every few hours), a small diamond on a short stem for one that
 *   does not (weekly, weekdays only, or any other calendar T16 could not call
 *   daily). A tick whose next run is more than 24 h away is dimmed.
 * - Anything hourly or faster is a bead on a fainter inner track that is one
 *   hour round (minutes past the hour, :00 at the back), one bead per run in
 *   the hour.
 * - When a job fires, its mark glows and a light runs once round its track;
 *   the mark stays lit while the job runs, then settles. A last run that
 *   failed is status red until a good run (Must 25).
 * - A job that launches a fleet job (T16's `launchesFleetJob`, a timer or
 *   cron line that runs `sam-dispatch`) is the trigger only (Must 27, T19):
 *   as it fires, a light rises from its mark into SAM's core (the mockup's
 *   "Schedule · <name> fired"), and that is all. The fleet job it starts is
 *   one real job in the job store, drawn on the floor under its General by
 *   `FloorState` (tagged `origin: 'schedule'`); the ring never draws a worker
 *   or a second mark for it.
 *
 * The live box has far more jobs than the mockup's fourteen, and many share
 * a time (several at 00:00), so two rules the mockup never needed keep marks
 * apart (at least 8 px at 1920, 6 px at laptop and phone sizes, check 31):
 * outer ticks that would sit too close are eased apart along the dial by the
 * least angle that clears them (each job keeps its own tick), and inner
 * beads closer than the gap share one bead (a bead is "something runs at
 * about this minute").
 *
 * No `CanvasRenderingContext2D` here, so spacing and placement are
 * testable without a browser (`ringRender.test.ts`). `FloorCanvas` paints
 * what `buildRing` returns.
 */

import type { ScheduleCadence, ScheduledJob } from '@/types/floor';
import { GEO, clamp, project } from './floorRender';
import type { Cam, Layout, Pt } from './floorRender';

/* ---------- constants ---------- */

export const RING = {
  /** The inner (hourly) track's radius, as a fraction of the dial's. */
  INNER: 0.74,
  /** The travelling light's lap, ms (the mockup's LAP of 1.6 demo seconds). */
  LAP_MS: 1600,
  /** A fired job stays lit at least this long, however short its run. */
  MIN_LIT_MS: 1600,
  /** The glow's fade after the run, ms. */
  SETTLE_MS: 600,
  NUMS: ['00', '06', '12', '18'] as const,
} as const;

export type RingVariant = 'desktop' | 'laptop' | 'phone';
/** Check 31's floors: marks at least this far apart (px, centre to centre). */
export const RING_MIN_GAP: Record<RingVariant, number> = { desktop: 8, laptop: 6, phone: 6 };
/** What the layout aims for: the floor plus a pixel, so rounding never lands under it. */
const GAP_MARGIN = 1;

const DAY_MS = 86_400_000;
const TAU = Math.PI * 2;

/* ---------- classification ---------- */

export type RingClass = 'frequent' | 'daily' | 'nondaily';
export type RingShape = 'line' | 'diamond' | 'bead';

/**
 * T16's `cadence` mapped onto the mockup's `ESCHED.kind`: hourly or faster is
 * a bead; every few hours or daily is a line; weekly, weekdays only and
 * anything else T16 could not call daily ('other': monthly, every few days)
 * is a diamond, since it does not run every day.
 */
export function ringClass(cadence: ScheduleCadence): RingClass {
  if (cadence === 'frequent') return 'frequent';
  if (cadence === 'hours' || cadence === 'daily') return 'daily';
  return 'nondaily';
}
export const shapeOf = (c: RingClass): RingShape => (c === 'frequent' ? 'bead' : c === 'daily' ? 'line' : 'diamond');

/**
 * Minutes between runs for a frequent job. T16 carries no interval field, so
 * it is read back from T16's own plain words ("Every 15 min", "Every
 * minute", "Hourly"); anything else hourly-or-faster counts as hourly.
 */
export function beadInterval(job: Pick<ScheduledJob, 'schedulePlain'>): number {
  const p = job.schedulePlain.trim();
  if (/^every minute$/i.test(p)) return 1;
  const m = p.match(/^every (\d+(?:\.\d+)?) min/i);
  if (m) return clamp(Number(m[1]), 1, 60);
  return 60;
}

/* ---------- time ---------- */

/** Minutes into the local day (the browser's clock, as the header clock). */
export function localMinuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000;
}
export type DayClock = (ms: number) => number;

const isoMs = (s: string | null): number | null => {
  if (!s || s === 'not recorded') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
/** Angle on the 24 h dial (0 at the back, clockwise as seen from above). */
export const dayAngle = (minuteOfDay: number) => ((((minuteOfDay % 1440) + 1440) % 1440) / 1440) * TAU;
/** Angle on the one-hour inner track. */
export const hourAngle = (minuteOfHour: number) => ((((minuteOfHour % 60) + 60) % 60) / 60) * TAU;

/* ---------- the dial ---------- */

export interface RingNumeral { t: string; r: [number, number, number, number] }

export interface RingGeo {
  cx: number; cy: number; rx: number; ry: number; k: number;
  /** A tick's length idle and lit (px), the same all the way round. */
  len: number; lenLit: number;
  /** Line-width scale. */
  px: number;
  numPx: number;
  nums: RingNumeral[];
  /** The dial's right edge, the 06 numeral included (the SAM label sits right of it). */
  right: number;
  /** SAM's core, canvas px: where a scheduled dispatch's trigger light ends (T19). */
  core: Pt;
}

export const onRing = (g: RingGeo, a: number, f: number): Pt => [g.cx + g.rx * f * Math.sin(a), g.cy - g.ry * f * Math.cos(a)];
/** The dial's outward direction at angle a, one screen px long, so a tick is the same length all the way round. */
export function outward(g: RingGeo, a: number): Pt {
  const x = g.rx * Math.sin(a), y = -g.ry * Math.cos(a), n = Math.hypot(x, y) || 1;
  return [x / n, y / n];
}
export const along = (p: Pt, n: Pt, d: number): Pt => [p[0] + n[0] * d, p[1] + n[1] * d];

/**
 * A numeral's width. A fixed estimate (two digits at 0.625 em), the same one
 * `buildScene` reserves for the SAM label's place, so the label and the 06
 * numeral can never disagree about where the dial ends.
 */
export const numeralWidth = (t: string, numPx: number) => t.length * 0.625 * numPx;

/**
 * The dial's size and where its numerals go, in canvas px (port of
 * `ringLayout`). `zeusDrawn`: 00 goes above Zeus's head (at the top of his
 * bob) when his bust is drawn, else on the track like the others.
 */
export function ringGeometry(layout: Layout, cam: Cam, zeusDrawn: boolean): RingGeo {
  // the dial grows with SAM (`samK`, the tall phone hero), ticks and numeral gaps with it
  const v = { W: layout.W, H: layout.H, cam }, k = cam.k * layout.samK, numPx = layout.opts.numPx;
  const c0 = project(v, 0, layout.samV, GEO.SZ2 + 1);
  const g: RingGeo = {
    cx: c0[0], cy: c0[1], rx: GEO.RR * 1.732 * k, ry: GEO.RR * k, k,
    len: Math.max(8, 12 * k), lenLit: Math.max(11, 16 * k), px: clamp(k, 0.6, 1.2), numPx, nums: [], right: 0,
    core: project(v, 0, layout.samV, GEO.COREZ),
  };
  const zu = layout.zeusU;
  const zeusTop = zeusDrawn ? project(v, 0, layout.samV, GEO.SZ2 - zu * 0.12 + 1.8)[1] - zu * cam.k - 2 : Infinity;
  g.nums = RING.NUMS.map((t, i) => {
    const a = (i * Math.PI) / 2, e = along(onRing(g, a, 1), outward(g, a), g.lenLit + 4), w = numeralWidth(t, numPx), h = numPx;
    // 00 never leaves the canvas: where Zeus stands too tall for it, it sits on the top of his head (the phone)
    const r: RingNumeral['r'] = i === 0 ? [e[0] - w / 2, Math.max(1, Math.min(e[1], zeusTop) - h), w, h]
      : i === 1 ? [e[0], e[1] - h / 2, w, h]
        : i === 2 ? [e[0] - w / 2, e[1], w, h]
          : [e[0] - w, e[1] - h / 2, w, h];
    return { t, r };
  });
  g.right = g.nums[1].r[0] + g.nums[1].r[2];
  return g;
}

/* ---------- firing: what changed between two polls ---------- */

export interface RingFx {
  /** jobId → when it was seen to fire (ms). */
  fires: Record<string, number>;
}
export const emptyRingFx = (): RingFx => ({ fires: {} });

/**
 * A timer fired when its last-run time moves on, or it starts running.
 * Never on the first poll (that is history, not a firing), and never for
 * cron, which keeps no run record (Must 25): its marks stay static.
 */
export function diffSchedule(prev: ScheduledJob[] | null, next: ScheduledJob[], now: number, fxIn: RingFx): RingFx {
  const fires: Record<string, number> = {};
  const ids = new Set(next.map((j) => j.id));
  for (const [id, at] of Object.entries(fxIn.fires)) if (ids.has(id) && now - at < 60_000) fires[id] = at;
  if (!prev) return { fires };
  const before = new Map(prev.map((j) => [j.id, j]));
  for (const j of next) {
    const p = before.get(j.id);
    if (!p || j.kind !== 'timer') continue;
    const ran = isoMs(j.lastRun) != null && j.lastRun !== p.lastRun;
    const started = j.lastResult === 'running' && p.lastResult !== 'running';
    const recent = fires[j.id] != null && now - fires[j.id] < 10_000;
    if (ran || (started && !recent)) fires[j.id] = now;
  }
  return { fires };
}

export type RingMarkState = 'firing' | 'running' | 'settling' | 'idle' | 'failed';
export interface JobRingState { state: RingMarkState; glow: number; lap: number | null }

/** A job's state at `now` (port of `ESCHED.status`). Reduced motion: lit if running, red if failed, nothing timed. */
export function jobRingState(job: ScheduledJob, fx: RingFx, now: number, reduced: boolean): JobRingState {
  const failed = job.lastResult === 'failed', running = job.lastResult === 'running';
  if (reduced) return running ? { state: 'running', glow: 0.7, lap: null } : { state: failed ? 'failed' : 'idle', glow: 0, lap: null };
  const at = fx.fires[job.id], e = at == null ? Infinity : now - at;
  if (e >= 0 && e < RING.LAP_MS) return { state: 'firing', glow: 1, lap: e / RING.LAP_MS };
  if (running || e < RING.MIN_LIT_MS) return { state: 'running', glow: 0.7, lap: null };
  if (!failed && e < RING.MIN_LIT_MS + RING.SETTLE_MS) {
    return { state: 'settling', glow: 0.7 * (1 - (e - RING.MIN_LIT_MS) / RING.SETTLE_MS), lap: null };
  }
  return { state: failed ? 'failed' : 'idle', glow: 0, lap: null };
}

/* ---------- the marks ---------- */

export type Box = [number, number, number, number];

export interface RingMark {
  /** The job's id for a tick; `bead@<minute>` for a bead. */
  id: string;
  /** Every job this mark stands for (a shared bead may stand for several). */
  jobIds: string[];
  shape: RingShape;
  track: 'outer' | 'inner';
  /** Angle on its track (after spacing; the canvas may ease towards it). */
  angle: number;
  /** The mark's centre, canvas px (what the spacing rule measures). */
  xy: Pt;
  box: Box;
  state: RingMarkState;
  glow: number;
  lap: number | null;
  /** Next run more than 24 h away. */
  dim: boolean;
}

/** One entry per job on the ring: where its own mark is (a bead job points at its current bead). */
export interface RingTick { jobId: string; markId: string; shape: RingShape; dim: boolean; state: RingMarkState; nextInMin: number | null }

export interface RingLap { a: number; p: number; f: number }

/**
 * A scheduled job that launches a fleet job, firing (T19, Must 27): the light
 * rising from its mark into SAM's core, as a cubic in canvas px (port of the
 * mockup's request pulse from `tickWorld` into the core). `p` is how far up
 * it has travelled, 0 to 1, over the firing lap.
 */
export interface RingTrigger { jobId: string; markId: string; curve: [Pt, Pt, Pt, Pt]; p: number }

export interface RingModel {
  geo: RingGeo;
  marks: RingMark[];
  ticks: RingTick[];
  /** Jobs with neither a next nor a last run time (e.g. cron's @reboot): listed in the Schedule panel, not placed. */
  unplaced: string[];
  /** The now hand and the minute notch on the inner track. */
  handAngle: number;
  minuteAngle: number;
  laps: RingLap[];
  /** Trigger lights for firing jobs that launch a fleet job; none under reduced motion. */
  triggers: RingTrigger[];
  /** Everything the ring draws, numerals included (T18's click target). */
  extent: Box;
}

export interface RingInput {
  now: number;
  fx?: RingFx;
  reduced?: boolean;
  variant: RingVariant;
  /** Minutes into the day for a time; the browser's local clock by default. */
  clock?: DayClock;
  /**
   * Eases a displayed angle towards its target (a tick gliding on to its next
   * run, the hand); keyed by mark id, '~hand' and '~min'. Exact when absent.
   */
  smooth?: (id: string, target: number) => number;
}

const grow = (b: Box, d: number): Box => [b[0] - d, b[1] - d, b[2] + 2 * d, b[3] + 2 * d];
function bbox(pts: Pt[]): Box {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}
export function union(a: Box | null, b: Box): Box {
  if (!a) return b;
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
}
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A diamond's four points round centre c, its long axis along n (port of `diamond`). */
export function diamondPts(c: Pt, n: Pt, d: number): Pt[] {
  const q: Pt = [-n[1] * d * 0.8, n[0] * d * 0.8];
  return [along(c, n, -d), [c[0] + q[0], c[1] + q[1]], along(c, n, d), [c[0] - q[0], c[1] - q[1]]];
}
export const diamondSize = (g: RingGeo) => Math.max(2.8, 3.8 * g.k);
export const beadRadius = (g: RingGeo) => Math.max(1.8, 2.6 * g.px);
export const tickWidth = (g: RingGeo) => 1.5 * Math.max(1, g.px);

/** Where an outer mark's centre sits at angle a (idle length), for spacing. */
function outerCentre(g: RingGeo, shape: RingShape, a: number): Pt {
  const n = outward(g, a), p0 = onRing(g, a, 1);
  return shape === 'diamond' ? along(p0, n, g.len * 0.4 + diamondSize(g)) : along(p0, n, g.len / 2);
}

/**
 * Eases outer ticks apart until every two neighbours are at least `gap` px
 * apart (centre to centre). Ticks that crowd form a group that is spread
 * evenly about the group's mean time, merging with the next group when they
 * touch, so the order round the dial is kept and each tick moves by the
 * least it must. With more ticks than the dial can hold at `gap`, they are
 * spaced evenly all the way round (the best there is).
 */
export function spreadOuter(g: RingGeo, items: { shape: RingShape; a: number }[], gap: number): number[] {
  const n = items.length, idx = items.map((_, i) => i).sort((i, j) => items[i].a - items[j].a || i - j);
  const target = idx.map((i) => items[i].a), shapes = idx.map((i) => items[i].shape);
  const centreAt = (s: number, a: number) => outerCentre(g, shapes[s], a);
  const ppr = (a: number) => {
    const h = 1e-3;
    return Math.max(0.5, dist(outerCentre(g, 'line', a - h), outerCentre(g, 'line', a + h)) / (2 * h));
  };
  const place = (scale: number): number[] => {
    // a group: consecutive ticks (by sorted index, unwrapped angles) laid out from `from` at the local step
    type Group = { ids: number[]; t: number[] };
    const lay = (gr: Group): number[] => {
      const step = (a: number) => (gap * scale) / ppr(a);
      const mean = gr.t.reduce((x, y) => x + y, 0) / gr.t.length;
      let span = 0;
      for (let i = 1; i < gr.ids.length; i++) span += step(mean + span - (span / 2));
      const out = [mean - span / 2];
      for (let i = 1; i < gr.ids.length; i++) out.push(out[i - 1] + step(out[i - 1]));
      return out;
    };
    let groups: Group[] = target.map((t, i) => ({ ids: [i], t: [t] }));
    for (let guard = 0; guard < 4 * n + 4 && groups.length > 1; guard++) {
      const pos = groups.map(lay);
      let merged = false;
      for (let i = 0; i < groups.length && !merged; i++) {
        const j = (i + 1) % groups.length, wrap = j === 0 ? TAU : 0;
        const aEnd = pos[i][pos[i].length - 1], bStart = pos[j][0] + wrap;
        const need = (gap * scale) / ppr((aEnd + bStart) / 2);
        if (bStart - aEnd >= need) continue;
        const a = groups[i], b = groups[j];
        const m: Group = { ids: [...a.ids, ...b.ids], t: [...a.t, ...b.t.map((t) => t + wrap)] };
        if (j === 0) { groups = [...groups.slice(1, i), m]; } else groups.splice(i, 2, m);
        merged = true;
      }
      if (!merged) break;
    }
    const out = new Array<number>(n);
    if (groups.length === 1 && n > 1) {
      const lp = lay(groups[0]);
      if (lp[lp.length - 1] - lp[0] + (gap * scale) / ppr(lp[0]) > TAU) {
        groups[0].ids.forEach((s, i) => { out[s] = lp[0] + (i * TAU) / n; }); // full: evenly round the dial
        return out;
      }
    }
    groups.forEach((gr) => lay(gr).forEach((a, i) => { out[gr.ids[i]] = a; }));
    return out;
  };
  let a = target.slice();
  if (n > 1) {
    for (let scale = 1, tries = 0; tries < 12; tries++, scale *= 1.08) {
      a = place(scale);
      let ok = true;
      for (let s = 0; s < n && ok; s++) {
        const t = (s + 1) % n;
        if (t !== s && dist(centreAt(s, a[s]), centreAt(t, a[t])) < gap) ok = false;
      }
      if (ok) break;
    }
  }
  const out = new Array<number>(n);
  idx.forEach((orig, s) => { out[orig] = ((a[s] % TAU) + TAU) % TAU; });
  return out;
}

/**
 * Bead positions (minutes past the hour) shared by every frequent job, with
 * beads closer than `gap` px merged into one (port of the bead loop in
 * `drawRing`, plus the merge the live box needs).
 */
function beadClusters(g: RingGeo, beads: { m: number; jobId: string }[], gap: number): { m: number; members: { m: number; jobId: string }[] }[] {
  const sorted = [...beads].sort((x, y) => x.m - y.m || (x.jobId < y.jobId ? -1 : 1));
  const clusters: { m: number; members: { m: number; jobId: string }[] }[] = [];
  const at = (m: number) => onRing(g, hourAngle(m), RING.INNER);
  for (const b of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && dist(at(last.m), at(b.m)) < gap) last.members.push(b);
    else clusters.push({ m: b.m, members: [b] });
  }
  // the circle closes: the last bead may sit too close to the first
  while (clusters.length > 1 && dist(at(clusters[clusters.length - 1].m), at(clusters[0].m)) < gap) {
    const tail = clusters.pop()!;
    clusters[0].members.push(...tail.members);
  }
  return clusters;
}

/** The trigger light's path: up from a mark's foot on the track, curving in over SAM's core (canvas px). */
export function triggerCurve(g: RingGeo, from: Pt): [Pt, Pt, Pt, Pt] {
  const k = g.k, core = g.core;
  return [from, [g.cx + (from[0] - g.cx) * 0.5, from[1] - 40 * k], [core[0], core[1] + 40 * k], core];
}

/**
 * The whole ring for one frame: every mark's place, shape, state and dim
 * flag, the hand, the travelling lights and the extent. Pure: the same jobs,
 * geometry and `now` always give the same ring.
 */
export function buildRing(jobs: ScheduledJob[], geo: RingGeo, input: RingInput): RingModel {
  const { now, variant } = input, fx = input.fx ?? emptyRingFx(), reduced = !!input.reduced, clock = input.clock ?? localMinuteOfDay;
  const gap = RING_MIN_GAP[variant] + GAP_MARGIN;
  const nowMin = clock(now);
  const marks: RingMark[] = [], ticks: RingTick[] = [], laps: RingLap[] = [], triggers: RingTrigger[] = [], unplaced: string[] = [];

  type Placed = { job: ScheduledJob; cls: RingClass; st: JobRingState; dim: boolean; nextInMin: number | null; when: number | null; last: number | null };
  const placed: Placed[] = [];
  for (const job of jobs) {
    const cls = ringClass(job.cadence), st = jobRingState(job, fx, now, reduced);
    const next = isoMs(job.nextRun), last = isoMs(job.lastRun);
    const lit = st.state === 'firing' || st.state === 'running';
    // while lit a tick sits at the run it is showing; after, at its next run (the mockup's st.at)
    const when = lit && last != null ? last : next ?? last;
    if (when == null) { unplaced.push(job.id); continue; }
    const nextInMin = next == null ? null : (next - now) / 60_000;
    placed.push({ job, cls, st, dim: next == null || next - now > DAY_MS, nextInMin, when, last });
  }

  /* the outer dial: lines and diamonds, eased apart where they crowd */
  const outer = placed.filter((p) => p.cls !== 'frequent');
  const angles = spreadOuter(geo, outer.map((p) => ({ shape: shapeOf(p.cls), a: dayAngle(clock(p.when!)) })), gap);
  const smooth = input.smooth ?? ((_id: string, t: number) => t);
  outer.forEach((p, i) => {
    const shape = shapeOf(p.cls), a = smooth(p.job.id, angles[i]), n = outward(geo, a), p0 = onRing(geo, a, 1), lw = tickWidth(geo);
    let xy: Pt, box: Box;
    if (shape === 'diamond') {
      const d = diamondSize(geo), cen = along(p0, n, geo.len * 0.4 + d);
      xy = cen; box = grow(bbox([p0, ...diamondPts(cen, n, d)]), lw / 2 + 0.5);
    } else {
      const failed = p.st.state === 'failed', L1 = failed ? geo.len : geo.len + (geo.lenLit - geo.len) * p.st.glow, p1 = along(p0, n, L1);
      xy = along(p0, n, L1 / 2); box = grow(bbox([p0, p1]), lw + (failed ? 1.5 : 0));
    }
    marks.push({ id: p.job.id, jobIds: [p.job.id], shape, track: 'outer', angle: a, xy, box, state: p.st.state, glow: p.st.glow, lap: p.st.lap, dim: p.dim });
    ticks.push({ jobId: p.job.id, markId: p.job.id, shape, dim: p.dim, state: p.st.state, nextInMin: p.nextInMin });
    if (p.st.lap != null && !reduced) {
      laps.push({ a, p: p.st.lap, f: 1 });
      if (p.job.launchesFleetJob) triggers.push({ jobId: p.job.id, markId: p.job.id, curve: triggerCurve(geo, p0), p: p.st.lap });
    }
  });

  /* the inner track: one bead per run in the hour, shared where runs crowd */
  const frequent = placed.filter((p) => p.cls === 'frequent');
  const beads: { m: number; jobId: string }[] = [];
  const phase = new Map<string, { lastM: number | null; nextM: number }>();
  for (const p of frequent) {
    const every = beadInterval(p.job), next = isoMs(p.job.nextRun) ?? p.when!;
    const nextM = ((clock(next) % 60) + 60) % 60;
    const lastM = p.last != null ? ((clock(p.last) % 60) + 60) % 60 : null;
    phase.set(p.job.id, { lastM, nextM });
    for (let m = nextM % every; m < 60 - 1e-9; m += every) beads.push({ m: Math.round(m * 1000) / 1000, jobId: p.job.id });
  }
  const clusters = beadClusters(geo, beads, gap);
  const near = (x: number, y: number) => { const d = Math.abs(x - y) % 60; return Math.min(d, 60 - d) < 0.5; };
  const rb = beadRadius(geo);
  const beadMarks = clusters.map((c) => {
    const a = hourAngle(c.m), xy = onRing(geo, a, RING.INNER);
    const jobIds = [...new Set(c.members.map((b) => b.jobId))];
    const mark: RingMark = {
      id: `bead@${c.m.toFixed(2)}`, jobIds, shape: 'bead', track: 'inner', angle: a, xy, box: grow([xy[0], xy[1], 0, 0], rb + 1),
      state: 'idle', glow: 0, lap: null, dim: false,
    };
    return { c, mark };
  });
  for (const p of frequent) {
    const ph = phase.get(p.job.id)!, lit = p.st.glow > 0.02 && (p.st.state === 'firing' || p.st.state === 'running' || p.st.state === 'settling');
    const mine = (m: number) => beadMarks.find((b) => b.c.members.some((x) => x.jobId === p.job.id && near(x.m, m)));
    const litBead = lit && ph.lastM != null ? mine(ph.lastM) : undefined;
    const own = litBead ?? mine(ph.nextM) ?? beadMarks.find((b) => b.mark.jobIds.includes(p.job.id));
    if (!own) continue;
    // the bead of the run that just happened lights (or, with no last-run time, the job's next bead)
    const m = own.mark;
    if (lit) {
      if (p.st.glow > m.glow) { m.glow = p.st.glow; m.state = p.st.state; m.lap = p.st.lap; }
      if (p.st.lap != null && !reduced) {
        laps.push({ a: m.angle, p: p.st.lap, f: RING.INNER });
        if (p.job.launchesFleetJob) triggers.push({ jobId: p.job.id, markId: m.id, curve: triggerCurve(geo, m.xy), p: p.st.lap });
      }
    } else if (p.st.state === 'failed' && m.glow <= 0.02) m.state = 'failed';
    ticks.push({ jobId: p.job.id, markId: m.id, shape: 'bead', dim: false, state: p.st.state, nextInMin: p.nextInMin });
  }
  marks.push(...beadMarks.map((b) => b.mark));

  /* the extent: the dial, every mark and the numerals */
  const px = geo.px;
  let ext: Box = [geo.cx - geo.rx - 3 * px, geo.cy - geo.ry - 3 * px, 2 * geo.rx + 6 * px, 2 * geo.ry + 6 * px];
  marks.forEach((m) => { ext = union(ext, m.box); });
  geo.nums.forEach((n) => { ext = union(ext, n.r); });

  return {
    geo, marks, ticks, unplaced, laps, triggers, extent: ext,
    handAngle: smooth('~hand', dayAngle(nowMin)), minuteAngle: smooth('~min', hourAngle(nowMin % 60)),
  };
}

/** Which ring variant a scene uses (the spacing floor differs). */
export function ringVariant(phone: boolean, laptop: boolean): RingVariant {
  return phone ? 'phone' : laptop ? 'laptop' : 'desktop';
}
