/**
 * SAM — floor renderer, the pure half.
 *
 * A port of the approved mockup's scene geometry (design source
 * `sam-ui-concepts/src/e-scene.js`, hybrid E: `fit`, `camFor`, `P`, `box`,
 * `samLink`/`wkLink`/`bez`, `drawPlinth`, `drawStation`, `drawPad`,
 * `figure`, `flow`/`pulse`, `hit`, and the backdrop's seeded vault graph).
 * Same units, same proportions, same colours.
 *
 * Everything here is plain maths on plain objects: a `FloorState` (from
 * `/api/fleet/floor`) plus a layout and a clock in, a `Scene` of drawable
 * shapes out. There are no `CanvasRenderingContext2D` calls, so the logic is
 * unit-testable under `node --test`; `FloorCanvas.tsx` only paints what
 * `buildScene` returns.
 *
 * Units: u runs across, v runs down the floor, z up; the camera maps world
 * (u, w = v - z) to canvas px. The real fleet replaces the mockup's
 * `stateAt(job, t)` timeline: figures come from `FloorState.generals[g]
 * .workers` (Must 7), idle comes from the reader (Must 10), slabs from
 * `towers` (Must 12), and the dispatch pulse / teal return are driven by
 * transitions between two polls (`diffFloor`, Must 9 and 11).
 */

import type { FloorState, FloorWorker, GeneralId } from '@/types/floor';

/* ---------- palette (SAM_ui emerald, teal the one secondary, status red for failure) ---------- */

export type RGB = readonly [number, number, number];
export const CORE: RGB = [61, 255, 90];
export const ACC: RGB = [157, 255, 112];
export const EDGE: RGB = [16, 185, 129];
export const DEEP: RGB = [6, 95, 70];
export const TEAL: RGB = [45, 212, 191];
export const MIST: RGB = [226, 255, 234];
export const BAD: RGB = [255, 122, 112];
/** Worker colour by model tier, as in the mockup (Opus near-white, Sonnet core, Haiku teal). */
export const MODEL_COLOUR: Record<string, RGB> = { Opus: [222, 255, 232], Sonnet: CORE, Haiku: TEAL };

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export const FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI","Inter","Ubuntu Sans","Helvetica Neue",Arial,sans-serif';

export type SpriteName = 'core' | 'teal' | 'acc' | 'edge' | 'mist' | 'bad';
export const SPRITE_COLOURS: Record<SpriteName, RGB> = { core: CORE, teal: TEAL, acc: ACC, edge: EDGE, mist: MIST, bad: BAD };

/* ---------- the fleet ---------- */

export const GENERALS: readonly { id: GeneralId; name: string; role: string }[] = [
  { id: 'hermes', name: 'Hermes', role: 'Growth' },
  { id: 'hephaestus', name: 'Hephaestus', role: 'Delivery' },
  { id: 'calliope', name: 'Calliope', role: 'Marketing' },
  { id: 'cerberus', name: 'Cerberus', role: 'Security' },
  { id: 'prometheus', name: 'Prometheus', role: 'R&D' },
];

/** The fleet key, a short column under "Fleet" in the scene's top-left corner. T17 appends the ring entries. */
export interface KeyItem {
  icon: 'link' | 'figure' | 'slab' | 'vault' | 'ring' | 'diamond'; text: string; optional?: boolean;
  /** A second icon and words on the same line (the ring's "· Hourly, inner" bead). */
  then?: { icon: 'bead'; text: string };
}
export const KEY_ITEMS: KeyItem[] = [
  { icon: 'link', text: 'Light on a link = work flowing' },
  { icon: 'figure', text: 'Figure = worker running' },
  { icon: 'slab', text: 'Slab = one job verified today' },
  { icon: 'vault', text: 'Floor graph = knowledge vault', optional: true },
  { icon: 'ring', text: 'Ring = scheduled jobs, 24 h' },
  { icon: 'diamond', text: 'Weekly or weekdays', then: { icon: 'bead', text: 'Hourly, inner' } },
];

/* ---------- geometry constants (units), straight from e-scene.js ---------- */

export const GEO = {
  GH: 40, GZ: 14, // General platform half-size and height
  SB: 46, STOP: 30, SZ1: 16, SZ2: 46, COREZ: 90, CORER: 17, // SAM plinth and floating core
  WH: 15, // worker pad half-size
  RR: 81, // the clock ring's radius (T17 draws it; the SAM label already sits clear of it)
} as const;

/** The phone's full-screen hero pins Zeus's head this far from the canvas top (the 00 numeral sits above it). */
const TOP_ANCHOR_PX = 48;

export interface SceneOptions {
  bustU: number; zeusU: number; zeusTop: number;
  spacing: number; cardPx: number; labelPx: number; labelW: number; minFont: number;
  pad: number; padTop: number; zoom: number; zoomCard: number; maxScale: number; numPx: number;
  /** Laptop layout drops the optional key entry and lets worker tasks wrap. */
  laptop: boolean;
  /** Pin the scene's top to the canvas top instead of centring (the phone's full-screen hero). */
  anchorTop?: boolean;
}

const BASE_OPTIONS: SceneOptions = {
  bustU: 72, zeusU: 120, zeusTop: 34, spacing: 230, cardPx: 78, labelPx: 30, labelW: 0.44,
  minFont: 11, pad: 18, padTop: 44, zoom: 1.7, zoomCard: 1.3, maxScale: 1.25, numPx: 12, laptop: false,
};
/** e-hybrid.html's desktop options. minFont is 11 here too: no canvas text under 11 px at desktop sizes. */
export const DESKTOP_OPTIONS: SceneOptions = { ...BASE_OPTIONS };
/** e-hybrid.html's laptop `sceneOpts()` (about 1200 to 1600 wide, or under about 800 tall). */
export const LAPTOP_OPTIONS: SceneOptions = { ...BASE_OPTIONS, padTop: 62, labelPx: 46, labelW: 0.42, minFont: 11, numPx: 11, laptop: true };
/** The mockup's laptop media query, verbatim. */
export const LAPTOP_QUERY = '(min-width:820px) and (max-width:1600px),(min-width:820px) and (max-height:800px)';
/**
 * e-phone.html's hero scene options (T13): `EScene(hero, { zeusTop: 6, spacing: 170, cardPx: 26, labelPx: 36,
 * pad: 10, padTop: 16, zoom: 1.9, zoomCard: 1, maxScale: 1, numPx: 10.5 })`. The phone draws no General cards,
 * no fleet key and no worker labels; its names and states are canvas text (`phoneLabels`).
 */
export const PHONE_OPTIONS: SceneOptions = {
  ...BASE_OPTIONS, zeusTop: 6, spacing: 170, cardPx: 26, labelPx: 36, pad: 10, padTop: 16, zoom: 1.9, zoomCard: 1,
  maxScale: 1, numPx: 10.5, anchorTop: true,
};

/* ---------- small maths ---------- */

export type Pt = [number, number];
export type Curve = [Pt, Pt, Pt, Pt];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lin = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function bez(c: Curve, t: number): Pt {
  const m = 1 - t;
  return [
    m * m * m * c[0][0] + 3 * m * m * t * c[1][0] + 3 * m * t * t * c[2][0] + t * t * t * c[3][0],
    m * m * m * c[0][1] + 3 * m * m * t * c[1][1] + 3 * m * t * t * c[2][1] + t * t * t * c[3][1],
  ];
}

/* ---------- layout (port of fit / camFor) ---------- */

export interface Cam { x: number; y: number; k: number }

export interface Layout {
  W: number; H: number; s: number;
  samV: number; cardTop: number; padV: number; top: number; bot: number;
  zeusU: number; bustU: number;
  GU: Record<GeneralId, number>;
  home: Cam;
  opts: SceneOptions;
}

export function computeLayout(W: number, H: number, opts: SceneOptions = DESKTOP_OPTIONS): Layout {
  const { COREZ, CORER, WH, SZ2 } = GEO;
  const GU = {} as Record<GeneralId, number>;
  GENERALS.forEach((g, i) => { GU[g.id] = (i - (GENERALS.length - 1) / 2) * opts.spacing; });
  const wU = opts.spacing * GENERALS.length + 8; // outer cards are as wide as a column
  const cardTop = 52;
  let s = 1, gapS = 0, gapW = 0, samV = -168, padV = 0, top = 0, bot = 0;
  const lay = () => {
    samV = -168 - gapS;
    const cardBot = cardTop + opts.cardPx / s;
    padV = cardBot + 44 + gapW + 14 / s;
    top = samV - COREZ - CORER * 1.6;
    bot = padV + WH + 6 + opts.labelPx / s;
  };
  const w = Math.max(1, W), h = Math.max(1, H);
  for (let i = 0; i < 8; i++) {
    lay();
    s = Math.min((w - 2 * opts.pad) / wU, (h - opts.pad - opts.padTop) / (bot - top), opts.maxScale);
    s = Math.max(0.05, s);
    const extra = (h - opts.pad - opts.padTop) / s - (bot - top);
    gapS = clamp(gapS + extra * 0.55, 0, 90);
    gapW = clamp(gapW + extra * 0.3, 0, 50);
  }
  lay();
  // The phone hero is full screen (100dvh) but the floor is width-bound, so centring leaves a big empty
  // band above SAM. Pin Zeus's head (and the 00 numeral above it) near the top instead; the spare height
  // falls below the Generals. Desktop and laptop keep the centred fit.
  const headTopW = samV - (GEO.SZ2 - opts.zeusU * 0.12 + opts.zeusU);
  const home: Cam = {
    x: 0,
    y: opts.anchorTop ? headTopW - (TOP_ANCHOR_PX - h / 2) / s : (top + bot) / 2 - (opts.padTop - opts.pad) / (2 * s),
    k: s,
  };
  // Zeus is as tall as fits between the fleet key and SAM's top tier (T8 draws him); Generals at most 70% of that.
  const tierY = h / 2 + (samV - SZ2 - home.y) * s;
  const zeusU = clamp((tierY - opts.zeusTop) / s / 0.88, 40, opts.zeusU);
  const bustU = Math.min(opts.bustU, zeusU * 0.7);
  return { W: w, H: h, s, samV, cardTop, padV, top, bot, zeusU, bustU, GU, home, opts };
}

/** The camera for a focused General (the zoom), or home. */
export function camFor(layout: Layout, id: GeneralId | null | undefined): Cam {
  if (!id) return layout.home;
  const { opts, H, s } = layout, top = -110, bot = layout.bot;
  const k = Math.min(s * opts.zoom, (H - opts.pad - opts.padTop) / (bot - top));
  return { x: layout.GU[id], y: (top + bot) / 2 - (opts.padTop - opts.pad) / (2 * k), k };
}

export function lerpCam(a: Cam, b: Cam, e: number): Cam {
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, k: a.k + (b.k - a.k) * e };
}

/** World (u, w) to canvas px. */
export interface View { W: number; H: number; cam: Cam }
export const toX = (v: View, u: number) => v.W / 2 + (u - v.cam.x) * v.cam.k;
export const toY = (v: View, w: number) => v.H / 2 + (w - v.cam.y) * v.cam.k;
export const project = (v: View, u: number, vv: number, z = 0): Pt => [toX(v, u), toY(v, vv - z)];

/* ---------- shapes ---------- */

export interface BoxShape { top: Pt[]; left: Pt[]; right: Pt[] }

/** An isometric box centred at (u, v) with half-size h, from z0 to z1 (the mockup's `box`). */
export function isoBox(view: View, u: number, v: number, h: number, z0: number, z1: number): BoxShape {
  const hw = h * 1.732, P = (a: number, b: number, c: number) => project(view, a, b, c);
  const t = [P(u, v - h, z1), P(u + hw, v, z1), P(u, v + h, z1), P(u - hw, v, z1)];
  const b = [P(u + hw, v, z0), P(u, v + h, z0), P(u - hw, v, z0)];
  return { top: t, left: [t[3], t[2], b[1], b[2]], right: [t[2], t[1], b[0], b[1]] };
}

export interface Glow { x: number; y: number; r: number; sprite: SpriteName; a: number }
export interface Filament { curve: Curve; t1: number; col: RGB; alpha: number; lit: boolean }
export interface Pulse { curve: Curve; p: number; len: number; col: RGB; sprite: SpriteName; alpha: number; r: number; back: boolean }
export interface Slab { box: BoxShape; top: string; left: string; right: string; outline: RGB; outlineAlpha: number }
export interface StagePad { quad: Pt[]; fill: string; glow: Glow | null; state: 'todo' | 'now' | 'done' | 'off' }
export type Seg = 'done' | 'now' | 'ver' | 'bad' | '';

export interface BustSlot {
  /** Bottom centre of the bust, canvas px. */
  x: number; y: number;
  /** Bust height, canvas px. */
  heightPx: number;
  /** The seam T8 reads: an idle General's bust draws at about 40%, a working one at full (Must 10). */
  idle: boolean;
  /** Additive brightness: 0.4 idle, 1 working, with the mockup's 0.3 s ramp on a change (static under reduced motion). */
  level: number;
  /** Emitter ring centre on the platform, canvas px. */
  emitter: Pt;
}

export interface Card {
  x: number; y: number; w: number; h: number; k: number;
  name: string; role: string; count: string; state: string;
  busy: boolean; hover: boolean; segs: Seg[];
}

export interface Station {
  id: GeneralId;
  name: string;
  idle: boolean;
  /** Platform activity 0..1 (the mockup's `act`). */
  act: number;
  hover: boolean;
  box: BoxShape;
  topFill: string; leftFill: string; rightFill: string;
  outline: RGB; outlineAlpha: number;
  glow: Glow | null;
  slabs: Slab[];
  stagePads: StagePad[];
  bustSlot: BustSlot;
  card: Card;
  /** Canvas x of the station centre, for DOM overlays. */
  cx: number;
}

export interface WorkerPad { box: BoxShape; lit: boolean; a: number }

export interface Figure {
  jobId: string;
  owner: GeneralId | 'sam';
  /** Pad centre on the floor (canvas px). */
  x: number; y: number;
  /** Camera scale times the pad scale. */
  k: number;
  col: RGB;
  vis: number; active: boolean; returned: boolean; dying: number; spawnK: number;
  failed: boolean;
  /** Seed for the figure's breathing glow. */
  i: number;
  /** Top centre of the label under the pad (canvas px). */
  lx: number; ly: number;
  label: { line1: string; line2: string; maxW: number } | null;
}

export interface CoreShape {
  /** SAM's node (the floating core) in canvas px. */
  x: number; y: number;
  glow: number; verifying: boolean; doneFlash: number; verifyK: number;
  bob: number;
}

export interface ZeusSlot { x: number; y: number; heightPx: number; ring: Pt; flare: boolean }

export interface SamLabel { x: number; y: number; state: string }

export interface Scene {
  view: View;
  cardK: number;
  plinth: { base: BoxShape; top: BoxShape; baseRim: Pt[]; glow: number; halo: Pt[] | null; haloCol: RGB; haloAlpha: number };
  baseLinks: Filament[];
  stations: Station[];
  litLinks: Filament[];
  core: CoreShape;
  zeusSlot: ZeusSlot;
  pads: WorkerPad[];
  figures: Figure[];
  pulses: Pulse[];
  samLabel: SamLabel;
  /** The clock ring's right edge (canvas px), numeral included; the SAM label sits right of it. */
  ringRight: number;
  /** The SAM tier's top centre, canvas px (T17 centres the ring here). */
  tier: Pt;
}

/* ---------- transitions between polls (the real fleet's version of the mockup's timeline) ---------- */

/** Timings in ms, from the mockup's timeline T (DISPATCH 2.6 → FAN 4.2, VERIFY 14.2 → PROOF_AT 15.2 → DONE 16.4 → FADE 17.8). */
export const FX = {
  DISPATCH: 1600, // the dispatch pulse SAM → General
  FANOUT: 950, // General → worker pad
  SPAWN_FROM: 600, SPAWN_TO: 1500, // the figure rises into its column of light
  RETURN: 800, // worker → General
  VERIFY: 1000, // General → SAM, teal (red for a failure)
  DROP: 800, // the new slab drops onto the tower
  FADE: 1400, // the returned figure fades
  IDLE_RAMP: 300, // bust brightness ramp
  KEEP: 6000, // forget an effect after this long
} as const;
/** A failed job stays on its pads in status red for this long after it ends, then leaves the floor. */
export const FAILED_HOLD_MS = 60_000;

export interface EndFx {
  jobId: string; owner: GeneralId | 'sam'; ok: boolean; at: number;
  /** Where its figure stood when it ended, so the fading figure stays put. */
  slot: number; slots: number; stageCount: number;
}

export interface FloorFx {
  dispatches: { jobId: string; owner: GeneralId | 'sam'; at: number }[];
  /** jobId → the time its fan-out starts (after the dispatch pulse if it was dispatched just now). */
  spawns: Record<string, number>;
  ends: EndFx[];
  idleFlips: Partial<Record<GeneralId, number>>;
  slabDrops: Partial<Record<GeneralId, { at: number; count: number }>>;
  /** Dispatch flare jobIds already played (so a flare in two polls plays once). */
  seenFlares: string[];
}

export function emptyFx(): FloorFx {
  return { dispatches: [], spawns: {}, ends: [], idleFlips: {}, slabDrops: {}, seenFlares: [] };
}

const isLive = (w: FloorWorker) => w.status === 'queued' || w.status === 'running';
const byStart = (a: FloorWorker, b: FloorWorker) =>
  (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.jobId.localeCompare(b.jobId);

function owners(state: FloorState): { owner: GeneralId | 'sam'; workers: FloorWorker[] }[] {
  return [
    ...GENERALS.map((g) => ({ owner: g.id as GeneralId | 'sam', workers: state.generals[g.id]?.workers ?? [] })),
    { owner: 'sam' as const, workers: state.samWorkers ?? [] },
  ];
}

/** A failed job that ended within the hold window (shown red on its pads), else false. */
export function failedRecently(w: FloorWorker, now: number): boolean {
  if (w.status !== 'failed' || !w.endedAt) return false;
  const t = Date.parse(w.endedAt);
  return Number.isFinite(t) && now - t < FAILED_HOLD_MS && now - t > -FAILED_HOLD_MS;
}

/** The figures an owner shows, in a stable order: queued and running jobs (Must 7), then a just-failed job in red. */
export function figureWorkers(workers: FloorWorker[], now: number): FloorWorker[] {
  const live = workers.filter(isLive).sort(byStart);
  const failed = workers.filter((w) => failedRecently(w, now)).sort(byStart);
  return [...live, ...failed];
}

/**
 * Works out what changed between two polls and records the effects to play:
 * a new dispatch flare → the dispatch pulse (Must 9); a new live job → its
 * figure spawns; a live job that left the floor → its proof returns to SAM in
 * teal and a slab drops (Must 11, 12); a job that turned `failed` → the
 * return in status red and no slab. The very first poll plays nothing: the
 * floor simply opens on the current state.
 */
export function diffFloor(prev: FloorState | null, next: FloorState, now: number, fxIn: FloorFx): FloorFx {
  const fx: FloorFx = {
    dispatches: fxIn.dispatches.filter((d) => now - d.at < FX.KEEP),
    spawns: Object.fromEntries(Object.entries(fxIn.spawns).filter(([, at]) => now - at < FX.KEEP)),
    ends: fxIn.ends.filter((e) => now - e.at < FX.KEEP),
    idleFlips: { ...fxIn.idleFlips },
    slabDrops: { ...fxIn.slabDrops },
    seenFlares: [...fxIn.seenFlares],
  };
  const flareIds = (next.dispatchFlares ?? []).map((f) => f.jobId);
  if (!prev) {
    fx.seenFlares = flareIds;
    return fx;
  }
  const ownerOf = new Map<string, GeneralId | 'sam'>();
  const nextById = new Map<string, FloorWorker>();
  owners(next).forEach(({ owner, workers }) => workers.forEach((w) => { ownerOf.set(w.jobId, owner); nextById.set(w.jobId, w); }));

  // 1. dispatches (Must 9: the pulse runs only on a dispatch)
  const dispatchedNow = new Set<string>();
  for (const id of flareIds) {
    if (fx.seenFlares.includes(id)) continue;
    fx.dispatches.push({ jobId: id, owner: ownerOf.get(id) ?? 'sam', at: now });
    dispatchedNow.add(id);
  }
  fx.seenFlares = flareIds;

  // 2. spawns and ends
  const prevLive = new Map<string, { owner: GeneralId | 'sam'; slot: number; slots: number; stageCount: number }>();
  owners(prev).forEach(({ owner, workers }) => {
    const shown = figureWorkers(workers, now);
    shown.forEach((w, i) => { if (isLive(w)) prevLive.set(w.jobId, { owner, slot: i, slots: Math.max(2, shown.length), stageCount: w.stagesPlanned?.length ?? 0 }); });
  });
  const prevIds = new Set<string>();
  owners(prev).forEach(({ workers }) => workers.forEach((w) => prevIds.add(w.jobId)));

  owners(next).forEach(({ workers }) => workers.forEach((w) => {
    if (isLive(w) && !prevLive.has(w.jobId) && fx.spawns[w.jobId] == null) {
      fx.spawns[w.jobId] = now + (dispatchedNow.has(w.jobId) ? FX.DISPATCH : 0);
    }
  }));
  const endedOk: Partial<Record<GeneralId, number>> = {};
  prevLive.forEach((info, jobId) => {
    const n = nextById.get(jobId);
    if (n && isLive(n)) return;
    // A job leaves the reader's floor only when it reached `done` (Must 11); `failed` stays, in red.
    const ok = !n || n.status === 'done';
    fx.ends.push({ jobId, owner: info.owner, ok, at: now, slot: info.slot, slots: info.slots, stageCount: info.stageCount });
    if (ok && info.owner !== 'sam') endedOk[info.owner] = (endedOk[info.owner] ?? 0) + 1;
  });
  // A job that failed between two polls without ever being seen live still shows red.
  owners(next).forEach(({ owner, workers }) => workers.forEach((w) => {
    if (w.status === 'failed' && !prevIds.has(w.jobId) && failedRecently(w, now)) {
      const shown = figureWorkers(workers, now);
      fx.ends.push({ jobId: w.jobId, owner, ok: false, at: now, slot: shown.indexOf(w), slots: Math.max(2, shown.length), stageCount: 0 });
    }
  }));

  // 3. idle flips and new slabs
  for (const g of GENERALS) {
    const a = prev.generals[g.id], b = next.generals[g.id];
    if (a && b && a.idle !== b.idle) fx.idleFlips[g.id] = now;
    const grew = (next.towers?.[g.id] ?? 0) - (prev.towers?.[g.id] ?? 0);
    if (grew > 0) {
      // the slab lands after the proof has made it back to SAM
      fx.slabDrops[g.id] = { at: now + (endedOk[g.id] ? FX.RETURN + FX.VERIFY : 0), count: grew };
    }
  }
  return fx;
}

/* ---------- worker pads: slot positions ---------- */

/** Pad positions under a General: the mockup's two pads (±0.23 of a column), spread wider when more jobs run. */
export function slotOffsets(n: number, spacing: number): { offsets: number[]; scale: number } {
  const count = Math.max(2, n);
  if (count === 2) return { offsets: [-spacing * 0.23, spacing * 0.23], scale: 1 };
  const span = spacing * 0.84, gap = span / (count - 1);
  const scale = Math.min(1, gap / (GEO.WH * 1.732 * 2 + 6));
  return { offsets: Array.from({ length: count }, (_, i) => -span / 2 + gap * i), scale };
}

/** SAM's own pads, for jobs no General owns (Must 17): a row left of the plinth. */
export function samSlotU(i: number): number {
  return -(GEO.SB * 1.732 + 66 + i * 60);
}

/* ---------- links ---------- */

export function samLink(layout: Layout, gu: number): Curve {
  const a: Pt = [0, layout.samV - GEO.COREZ + GEO.CORER * 0.9], b: Pt = [gu, -GEO.GH - GEO.GZ + 2];
  return [a, [gu * 0.08, a[1] + 70], [gu, b[1] - 70], b];
}

export function wkLink(layout: Layout, gu: number, padU: number, cardBot: number): Curve {
  const side = clamp((padU - gu) / (layout.opts.spacing * 0.23), -1.6, 1.6);
  const a: Pt = [gu + side * 10, cardBot], b: Pt = [padU, layout.padV - GEO.WH];
  return [a, [a[0], a[1] + 26], [padU, b[1] - 20], b];
}

export function samWorkerLink(layout: Layout, padU: number): Curve {
  const a: Pt = [0, layout.samV - GEO.COREZ + GEO.CORER * 0.9], b: Pt = [padU, layout.samV + 22 - GEO.WH];
  return [a, [a[0] - 30, a[1] + 10], [padU, b[1] - 40], b];
}

/** Steady flow while work is out: two small lights riding the link every `period` seconds (the mockup's `flow`). */
function flow(out: Pulse[], c: Curve, time: number, period: number, col: RGB, sprite: SpriteName, a: number, up: boolean, r: number) {
  for (let k = 0; k < 2; k++) {
    let p = ((time / period) + k / 2) % 1;
    if (up) p = 1 - p;
    out.push({ curve: c, p, len: 0.12, col, sprite, alpha: a * Math.sin(Math.PI * p), r, back: up });
  }
}

/* ---------- labels ---------- */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export function durText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function workerLines(w: FloorWorker): { line1: string; line2: string } {
  if (w.status === 'failed') return { line1: 'Failed', line2: 'Ended non-zero' };
  if (w.status === 'queued') return { line1: 'Queued', line2: 'Standing by' };
  const st = w.stages ?? null;
  if (st && st.length) {
    const now = st.findIndex((x) => x.state === 'now');
    const done = st.filter((x) => x.state === 'done').length;
    const name = now >= 0 ? st[now].name : done === st.length ? 'Stages done' : st[Math.min(done, st.length - 1)].name;
    return { line1: cap(name), line2: `Stage ${Math.min(st.length, now >= 0 ? now + 1 : done)} of ${st.length}` };
  }
  return { line1: 'Running', line2: durText(w.elapsedMs) };
}

/* ---------- the scene ---------- */

export interface SceneInput {
  now: number;
  fx?: FloorFx;
  reduced?: boolean;
  hover?: GeneralId | null;
  /** Override the camera (the zoom); defaults to home. */
  cam?: Cam;
}

/** The figures shown per owner, for tests and for module counts. */
export function figureCounts(state: FloorState, now: number): Record<GeneralId | 'sam', number> {
  const out = {} as Record<GeneralId | 'sam', number>;
  owners(state).forEach(({ owner, workers }) => { out[owner] = figureWorkers(workers, now).length; });
  return out;
}

export function buildScene(state: FloorState, layout: Layout, input: SceneInput): Scene {
  const { now } = input, fx = input.fx ?? emptyFx(), red = !!input.reduced, time = now / 1000;
  const { GH, GZ, SB, STOP, SZ1, SZ2, COREZ, WH } = GEO;
  const opts = layout.opts, s = layout.s;
  const cam = input.cam ?? layout.home;
  const view: View = { W: layout.W, H: layout.H, cam };
  const k = cam.k, X = (u: number) => toX(view, u), Y = (w: number) => toY(view, w);
  const P = (u: number, v: number, z = 0) => project(view, u, v, z);
  const cardK = 1 + (clamp(k / s, 1, 3) - 1) * (opts.zoomCard - 1) / (opts.zoom - 1);
  const cardBot = layout.cardTop + opts.cardPx * cardK / k;
  const since = (at: number) => now - at;
  const live = (at: number, dur: number) => !red && since(at) >= 0 && since(at) <= dur;

  // effects in flight
  const dispatchOf = (owner: GeneralId | 'sam') => fx.dispatches.find((d) => d.owner === owner && live(d.at, FX.DISPATCH));
  const endsOf = (owner: GeneralId | 'sam') => fx.ends.filter((e) => e.owner === owner);
  const verifyOf = (owner: GeneralId | 'sam') => endsOf(owner).find((e) => live(e.at + FX.RETURN, FX.VERIFY));
  const anyDispatch = !red && fx.dispatches.some((d) => live(d.at, FX.DISPATCH));
  const okEnds = fx.ends.filter((e) => e.ok);
  const verifying = !red && okEnds.some((e) => live(e.at + FX.RETURN + FX.VERIFY * 0.6, FX.VERIFY * 0.6 + FX.DROP + 400));
  const verifyEnd = okEnds.find((e) => live(e.at + FX.RETURN + FX.VERIFY * 0.6, FX.VERIFY * 0.6 + FX.DROP + 400));
  const verifyK = verifyEnd ? lin(now, verifyEnd.at + FX.RETURN + FX.VERIFY * 0.6, verifyEnd.at + FX.RETURN + FX.VERIFY + FX.DROP) : 0;
  const flashEnd = okEnds.find((e) => live(e.at + FX.RETURN + FX.VERIFY + FX.DROP + 400, 1400));
  const doneFlash = flashEnd ? 1 - lin(now, flashEnd.at + FX.RETURN + FX.VERIFY + FX.DROP + 400, flashEnd.at + FX.RETURN + FX.VERIFY + FX.DROP + 1800) : 0;

  const totalRunning = owners(state).reduce((a, o) => a + o.workers.filter((w) => w.status === 'running').length, 0);
  const samGlow = anyDispatch || verifying ? 1 : totalRunning > 0 ? 0.55 : 0.25;

  /* SAM's plinth (drawPlinth) */
  const v0 = layout.samV;
  const plinthBase = isoBox(view, 0, v0, SB, 0, SZ1);
  const plinthTop = isoBox(view, 0, v0, STOP, SZ1, SZ2);
  const baseRim = [P(0, v0 - SB, SZ1), P(SB * 1.732, v0, SZ1), P(0, v0 + SB, SZ1), P(-SB * 1.732, v0, SZ1)];
  let halo: Pt[] | null = null;
  if (verifying || doneFlash > 0) {
    const kk = verifying ? verifyK : 1;
    halo = [];
    for (let i = 0; i <= 60 * kk; i++) {
      const a = -Math.PI / 2 + i / 60 * Math.PI * 2;
      halo.push(P(Math.cos(a) * 36, v0 + Math.sin(a) * 21, SZ2 + 1));
    }
  }

  /* base filaments: SAM → every General, and each General's (dashed-pad) worker routes */
  const baseLinks: Filament[] = [], litLinks: Filament[] = [], pulses: Pulse[] = [];
  const figs: Figure[] = [], pads: WorkerPad[] = [];
  const stations: Station[] = [];

  GENERALS.forEach((g, gi) => {
    const gu = layout.GU[g.id], entry = state.generals[g.id] ?? { idle: true, workers: [] };
    const shown = figureWorkers(entry.workers, now);
    const idle = !!entry.idle;
    const dp = dispatchOf(g.id), ver = verifyOf(g.id);
    const route = samLink(layout, gu);
    const routeLit = !idle || !!dp || !!ver;
    baseLinks.push({ curve: route, t1: 1, col: EDGE, alpha: routeLit ? 0 : 0.5, lit: false });

    const { offsets, scale } = slotOffsets(shown.length, opts.spacing);
    offsets.forEach((off) => baseLinks.push({ curve: wkLink(layout, gu, gu + off, cardBot), t1: 1, col: EDGE, alpha: 0.22, lit: false }));

    /* the station (drawStation) */
    const hover = input.hover === g.id;
    const act = idle ? 0 : 1;
    const failFlash = endsOf(g.id).some((e) => !e.ok && live(e.at, FX.RETURN + FX.VERIFY + 1200));
    const box = isoBox(view, gu, 0, GH, 0, GZ);
    const c = P(gu, 0, GZ);
    // tower on the left of the platform: one slab per job verified today (Must 12); taller days pack tighter
    const nSlabs = Math.max(0, state.towers?.[g.id] ?? 0);
    const pitch = nSlabs > 10 ? 110 / nSlabs : 11, slabH = pitch * (8 / 11), tu = gu - 36;
    const drop = fx.slabDrops[g.id];
    const slabs: Slab[] = [];
    for (let i = 0; i < nSlabs; i++) {
      const fresh = !!drop && i >= nSlabs - drop.count && since(drop.at) < FX.DROP + 1600 && !red;
      const falling = fresh && since(drop!.at) < FX.DROP;
      const dz = falling ? (1 - lin(now, drop!.at, drop!.at + FX.DROP)) * 34 : 0;
      const hidden = fresh && since(drop!.at) < 0; // still waiting for the proof to reach SAM
      if (hidden) continue;
      const z0 = GZ + 3 + i * pitch;
      const tb = isoBox(view, tu, 0, 11, z0 + dz, z0 + slabH + dz);
      slabs.push({
        box: tb,
        top: falling ? rgba(TEAL, 0.6) : fresh ? rgba(ACC, 0.6) : rgba(EDGE, 0.2 + act * 0.14),
        left: rgba(DEEP, 0.55 + act * 0.2), right: rgba(DEEP, 0.35 + act * 0.15),
        outline: falling ? TEAL : fresh ? ACC : EDGE, outlineAlpha: fresh ? 0.9 : 0.34 + act * 0.3,
      });
    }
    // stage pads along the front-right edge: the first running job's real stages, never a guess (Must 8, 17)
    const primary = shown.find((w) => w.status === 'running' && w.stages && w.stages.length) ?? null;
    let padStates: ('todo' | 'now' | 'done' | 'off')[] = ['off', 'off', 'off', 'off', 'off'];
    if (primary) padStates = primary.stages!.slice(0, 8).map((x) => x.state);
    else {
      const justDone = endsOf(g.id).find((e) => e.ok && e.stageCount > 0 && live(e.at, FX.RETURN + FX.VERIFY + FX.DROP + 1400));
      if (justDone) padStates = Array.from({ length: Math.min(8, justDone.stageCount) }, () => 'done' as const);
    }
    const nP = padStates.length;
    const stagePads: StagePad[] = padStates.map((st, i) => {
      const kk = (i + 1) / (nP + 1), pu = gu + GH * 1.732 * kk - 4, pv = GH * (1 - kk) - 7;
      const col = st === 'done' ? ACC : CORE;
      const quad = [P(pu, pv - 3.2, GZ), P(pu + 5.5, pv, GZ), P(pu, pv + 3.2, GZ), P(pu - 5.5, pv, GZ)];
      const a = st === 'done' ? 0.8 : st === 'now' ? 0.55 + (red ? 0.35 : 0.35 * Math.sin(time * 6)) : 0;
      const pc = P(pu, pv, GZ);
      const glow: Glow | null = st === 'now' || st === 'done'
        ? { x: pc[0], y: pc[1], r: (st === 'now' ? 16 : 8) * k, sprite: st === 'done' ? 'acc' : 'core', a: st === 'now' ? 0.6 : 0.3 }
        : null;
      return { quad, fill: a ? rgba(col, a) : 'rgba(61,255,90,.09)', glow, state: st };
    });
    // the bust slot (T8 draws the bust; brightness follows idle, Must 10)
    const flip = fx.idleFlips[g.id];
    let level = idle ? 0.4 : 1;
    if (!red && flip != null && since(flip) < FX.IDLE_RAMP) {
      const r = lin(now, flip, flip + FX.IDLE_RAMP);
      level = idle ? 1 - 0.6 * r : 0.4 + 0.6 * r;
    }
    const bU = layout.bustU, bu = gu + opts.spacing * 0.06;
    const bBase = P(bu, -4, GZ + bU * 0.08);
    const bustSlot: BustSlot = { x: bBase[0], y: bBase[1], heightPx: bU * k, idle, level, emitter: P(bu, -4, GZ) };
    // the card (the mockup's DOM .gcard, painted on the canvas here)
    const running = shown.filter((w) => w.status === 'running').length;
    const queued = shown.filter((w) => w.status === 'queued').length;
    const failedNow = shown.some((w) => w.status === 'failed');
    let stateText = 'Idle';
    if (running) {
      const lines = primary ? workerLines(primary).line1 : '';
      stateText = 'Working' + (lines ? ' · ' + lines : '') + (running > 1 ? ` · ${running} jobs` : '');
    } else if (queued) stateText = `Idle · ${queued} queued`;
    if (failedNow && !running) stateText = 'Last job failed';
    let segs: Seg[] = ['', '', '', '', ''];
    if (primary) segs = primary.stages!.slice(0, 8).map((x) => (x.state === 'todo' ? '' : x.state));
    else if (padStates[0] === 'done') segs = padStates.map(() => 'done');
    if (ver && ver.ok) segs = segs.map((x) => x || 'ver');
    if (failedNow && !running) segs = segs.map(() => 'bad');
    const gw = opts.spacing * s * cardK - 14 * cardK;
    const card: Card = {
      x: X(gu) - gw / 2, y: Y(layout.cardTop), w: gw, h: opts.cardPx * cardK, k: cardK,
      name: g.name, role: g.role, count: `${nSlabs} today`, state: stateText,
      busy: !idle, hover, segs,
    };
    stations.push({
      id: g.id, name: g.name, idle, act, hover, box,
      topFill: act > 0.05 ? '#0f3122' : '#0a2218', leftFill: '#06150e', rightFill: '#030c08',
      outline: failFlash ? BAD : CORE, outlineAlpha: failFlash ? 0.9 : 0.2 + act * 0.7 + (hover ? 0.3 : 0),
      glow: act > 0.05 ? { x: c[0], y: c[1], r: 110 * k, sprite: 'core', a: 0.16 * act } : null,
      slabs, stagePads, bustSlot, card, cx: X(gu),
    });

    /* the lit route: working, or carrying a dispatch or a return */
    const reach = dp ? ease(lin(now, dp.at, dp.at + FX.DISPATCH)) : 1;
    if (routeLit) {
      const col = ver ? (ver.ok ? TEAL : BAD) : CORE;
      litLinks.push({ curve: route, t1: red ? 1 : reach, col, alpha: 0.95, lit: true });
    }

    /* worker pads and figures (drawPad, figure) */
    offsets.forEach((off, i) => {
      const u = gu + off, w = shown[i];
      const pb = isoBox(view, u, layout.padV, WH * scale, 0, 3);
      const p = P(u, layout.padV, 3);
      if (!w) { pads.push({ box: pb, lit: false, a: 0 }); return; }
      const spawnAt = fx.spawns[w.jobId];
      const spawning = spawnAt != null && !red && since(spawnAt) < FX.SPAWN_TO;
      const vis = spawning ? lin(now, spawnAt, spawnAt + FX.FANOUT) : 1;
      const spawnK = spawning ? lin(now, spawnAt + FX.SPAWN_FROM, spawnAt + FX.SPAWN_TO) : 1;
      const failed = w.status === 'failed';
      const active = w.status === 'running';
      pads.push({ box: pb, lit: vis > 0, a: vis });
      const link = wkLink(layout, gu, u, cardBot);
      if (vis > 0) {
        const fanP = spawning && since(spawnAt) <= FX.FANOUT ? ease(lin(now, spawnAt, spawnAt + FX.FANOUT)) : 1;
        litLinks.push({ curve: link, t1: fanP, col: failed ? BAD : CORE, alpha: vis * (active ? 0.75 : 0.35), lit: true });
        if (spawning && since(spawnAt) >= 0 && since(spawnAt) <= FX.FANOUT) {
          pulses.push({ curve: link, p: fanP, len: 0.4, col: MIST, sprite: 'core', alpha: 1, r: 22 * k, back: false });
        }
        if (active && !red && !spawning) flow(pulses, link, time + i * 0.4, 1.1, CORE, 'core', 0.7, false, 11 * k);
      }
      const lines = workerLines(w);
      const lp = P(u, layout.padV + WH * scale + 4);
      figs.push({
        jobId: w.jobId, owner: g.id, x: p[0], y: p[1], k: k * scale, lx: lp[0], ly: lp[1],
        col: failed ? BAD : CORE, vis, active, returned: false, dying: 0, spawnK, failed, i: gi * 3 + i,
        label: { ...lines, maxW: Math.min(opts.spacing * opts.labelW, (offsets.length > 2 ? opts.spacing * 0.84 / (offsets.length - 1) : opts.spacing * 0.46) - 4) * k },
      });
    });
    // a returned figure fades where it stood
    endsOf(g.id).forEach((e) => {
      if (red || shown.some((w) => w.jobId === e.jobId)) return;
      const t0 = e.at, endT = t0 + FX.RETURN + FX.VERIFY + FX.FADE;
      if (now < t0 || now > endT) return;
      const { offsets: o2, scale: sc2 } = slotOffsets(e.slots, opts.spacing);
      const u = gu + (o2[e.slot] ?? 0), p = P(u, layout.padV, 3), link = wkLink(layout, gu, u, cardBot);
      const dying = lin(now, t0 + FX.RETURN + FX.VERIFY, endT);
      figs.push({
        jobId: e.jobId, owner: g.id, x: p[0], y: p[1], k: k * sc2, lx: p[0], ly: p[1], col: e.ok ? CORE : BAD,
        vis: 1, active: false, returned: true, dying, spawnK: 1, failed: !e.ok, i: gi * 3 + e.slot, label: null,
      });
      if (live(t0, FX.RETURN)) pulses.push({ curve: link, p: 1 - ease(lin(now, t0, t0 + FX.RETURN)), len: 0.4, col: e.ok ? ACC : BAD, sprite: e.ok ? 'acc' : 'bad', alpha: 1, r: 20 * k, back: true });
    });

    /* lights along the route: steady flow while working, the dispatch pulse, the proof's return */
    if (!red) {
      if (!idle && !dp) flow(pulses, route, time + gi * 0.3, 1.5, CORE, 'core', 0.75, false, 14 * k);
      if (dp) pulses.push({ curve: route, p: reach, len: 0.28, col: MIST, sprite: 'core', alpha: 1, r: 34 * k, back: false });
      if (ver) {
        const p = ease(lin(now, ver.at + FX.RETURN, ver.at + FX.RETURN + FX.VERIFY));
        pulses.push({ curve: route, p: 1 - p, len: 0.28, col: ver.ok ? TEAL : BAD, sprite: ver.ok ? 'teal' : 'bad', alpha: 1, r: 34 * k, back: true });
      }
    }
  });

  /* SAM's own jobs (no General, Must 17): pads beside the plinth, start/running/end only */
  const samShown = figureWorkers(state.samWorkers ?? [], now);
  samShown.forEach((w, i) => {
    const u = samSlotU(i), v = layout.samV + 22;
    const link = samWorkerLink(layout, u);
    const spawnAt = fx.spawns[w.jobId];
    const spawning = spawnAt != null && !red && since(spawnAt) < FX.SPAWN_TO;
    const vis = spawning ? lin(now, spawnAt, spawnAt + FX.FANOUT) : 1;
    const active = w.status === 'running', failed = w.status === 'failed';
    baseLinks.push({ curve: link, t1: 1, col: EDGE, alpha: 0.22, lit: false });
    if (vis > 0) litLinks.push({ curve: link, t1: 1, col: failed ? BAD : CORE, alpha: vis * (active ? 0.6 : 0.3), lit: true });
    if (active && !red && !spawning) flow(pulses, link, time + i * 0.5, 1.3, CORE, 'core', 0.6, false, 11 * k);
    pads.push({ box: isoBox(view, u, v, WH, 0, 3), lit: vis > 0, a: vis });
    const p = P(u, v, 3), lp = P(u, v + WH + 4);
    figs.push({
      jobId: w.jobId, owner: 'sam', x: p[0], y: p[1], k, lx: lp[0], ly: lp[1],
      col: failed ? BAD : CORE, vis, active, returned: false, dying: 0,
      spawnK: spawning ? lin(now, spawnAt + FX.SPAWN_FROM, spawnAt + FX.SPAWN_TO) : 1, failed, i: 20 + i,
      label: { ...workerLines(w), maxW: 56 * k },
    });
  });

  /* SAM's core and Zeus's slot */
  const bob = red ? 0 : Math.sin(time * 1.2) * 3;
  const coreP = P(0, v0, COREZ + bob);
  const zu = layout.zeusU;
  const zBase = P(0, v0, SZ2 - zu * 0.12 + bob * 0.6);
  const core: CoreShape = { x: coreP[0], y: coreP[1], glow: samGlow, verifying, doneFlash, verifyK, bob };
  const zeusSlot: ZeusSlot = { x: zBase[0], y: zBase[1], heightPx: zu * k, ring: P(0, v0, SZ2), flare: anyDispatch };

  /* the SAM label sits just right of the clock ring (its 06 numeral included) */
  const tier = P(0, v0, SZ2 + 1);
  const ringRight = tier[0] + GEO.RR * 1.732 * k + Math.max(11, 16 * k) + 4 + opts.numPx * 1.25;
  const nodeP = P(0, v0, COREZ);
  const samState = anyDispatch ? 'Dispatching' : verifying ? 'Checking proof' : totalRunning > 0 ? `Supervising ${totalRunning} job${totalRunning === 1 ? '' : 's'}` : 'Idle';
  const samLabel: SamLabel = { x: Math.max(nodeP[0] + 30 * k, ringRight + 12), y: nodeP[1] - 30, state: samState };

  return {
    view, cardK,
    plinth: {
      base: plinthBase, top: plinthTop, baseRim, glow: samGlow, halo,
      haloCol: verifying ? TEAL : ACC, haloAlpha: verifying ? 0.95 : 0.9 * doneFlash,
    },
    baseLinks, stations, litLinks, core, zeusSlot, pads, figures: figs, pulses, samLabel, ringRight, tier,
  };
}

/* ---------- hit test (port of `hit`) ---------- */

/** Which General's column (station, card or pads) a canvas-local point falls in, or null. */
export function hitGeneral(layout: Layout, cam: Cam, x: number, y: number): GeneralId | null {
  const view: View = { W: layout.W, H: layout.H, cam };
  if (x < 0 || y < 0 || x > layout.W || y > layout.H) return null;
  let best: GeneralId | null = null;
  for (const g of GENERALS) {
    const cx = toX(view, layout.GU[g.id]);
    if (Math.abs(x - cx) < layout.opts.spacing * cam.k * 0.48 && y > toY(view, -GEO.GH - 70) && y < toY(view, layout.bot)) best = g.id;
  }
  return best;
}

/* ---------- the phone's canvas labels (e-phone.html `labels`, T13) ---------- */

/** e-phone.html's own label font stack. */
export const PHONE_FONT = '-apple-system,"Segoe UI","Ubuntu Sans",sans-serif';

export interface PhoneGeneralLabel {
  id: GeneralId;
  name: string;
  state: string;
  busy: boolean;
  /** Centre x and the top of the label block (the card row's top), canvas px; name at y + 10, state at y + 22. */
  x: number; y: number;
}

export interface PhoneLabels {
  generals: PhoneGeneralLabel[];
  /** Left x of "SAM / ORCHESTRATOR", and SAM's node y (no bob); SAM at y - 2, ORCHESTRATOR at y + 9. */
  sam: { x: number; y: number };
}

/**
 * Where the phone hero's text goes and what it says. The mockup shows the
 * focused job's lifecycle word under its General ('Running'), 'Working' under
 * any other busy one and 'Idle' otherwise; the live fleet has no single
 * focused job, so each General shows its own jobs' real state: 'Running' if
 * any is running, 'Queued' if only queued, else 'Idle'. The SAM tag sits
 * right of Zeus (when his bust is drawn) and right of the clock ring, as in
 * the mockup.
 */
export function phoneLabels(scene: Scene, layout: Layout, state: FloorState, zeusDrawn: boolean): PhoneLabels {
  const v = scene.view, y = toY(v, layout.cardTop);
  const generals = scene.stations.map((st): PhoneGeneralLabel => {
    const ws = state.generals[st.id]?.workers ?? [];
    const busy = !st.idle;
    const label = !busy ? 'Idle'
      : ws.some((w) => w.status === 'running') ? 'Running'
        : ws.some((w) => w.status === 'queued') ? 'Queued' : 'Working';
    return { id: st.id, name: st.name, state: label, busy, x: st.cx, y };
  });
  const nodeX = toX(v, 0), nodeY = toY(v, layout.samV - GEO.COREZ);
  const zs = scene.zeusSlot;
  const zeusRight = zs.x - zs.heightPx / 2 + zs.heightPx * 0.84;
  const sx = Math.max(zeusDrawn ? Math.max(nodeX + 16, zeusRight) : nodeX + 16, scene.ringRight + 7);
  return { generals, sam: { x: sx, y: nodeY } };
}

/* ---------- the backdrop's seeded data (the vault etched into the floor, the neon accents) ---------- */

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VaultData {
  nodes: { u: number; v: number; r: number; lit: boolean; t: boolean }[];
  links: [number, number, number][];
  neon: { gx: number; gy: number; h: boolean; len: number; teal: boolean }[];
}
let vaultCache: VaultData | null = null;
/** The mockup's seeded backdrop (rng(11)): 260 vault nodes, their nearest-neighbour links, 46 neon floor accents. */
export function vaultData(): VaultData {
  if (vaultCache) return vaultCache;
  const r = rng(11);
  const nodes: VaultData['nodes'] = [], links: VaultData['links'] = [], neon: VaultData['neon'] = [];
  for (let i = 0; i < 260; i++) nodes.push({ u: -820 + r() * 1640, v: -360 + r() * 820, r: 0.7 + r() * 1.5, lit: r() < 0.06, t: r() < 0.3 });
  nodes.forEach((p, i) => nodes
    .map((q, j) => [j, (q.u - p.u) ** 2 + (q.v - p.v) ** 2] as [number, number])
    .filter((d) => d[0] > i).sort((a, b) => a[1] - b[1]).slice(0, 2 + (r() < 0.35 ? 1 : 0))
    .forEach(([j, d2]) => { if (d2 < 140 * 140) links.push([i, j, 0.05 + r() * 0.1]); }));
  for (let i = 0; i < 46; i++) neon.push({ gx: Math.floor(r() * 30) - 15, gy: Math.floor(r() * 30) - 15, h: r() < 0.5, len: 0.35 + r() * 0.5, teal: r() < 0.3 });
  vaultCache = { nodes, links, neon };
  return vaultCache;
}

/** The floor grid's isometric mapping (the mockup's `iso`). */
export const iso = (x: number, y: number): Pt => [(x - y) * 0.866, (x + y) * 0.5];
