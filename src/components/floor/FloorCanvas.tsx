'use client';

/**
 * SAM — the fleet floor canvas (mockup E's scene, live).
 *
 * Polls `/api/fleet/floor` every 3 s (Must 13) and paints the shapes
 * `floorRender.buildScene` returns: SAM's plinth at the top centre, the five
 * Generals' stations in a row beneath (towers, stage pads), their worker pads
 * and figures, A's filament links with travelling lights, and the emerald
 * backdrop with the knowledge vault etched into the floor. The paint
 * routines are ports of the design source's `e-scene.js` (`glow`, `poly`,
 * `box`, `neon`/`outline`, `strokeCurve`/`filament`, `pulse`,
 * `drawBackdrop`, `drawPlinth`, `drawCore`, `drawStation`, `drawPad`,
 * `figure`, `workerLabel`) and of e-hybrid.html's General cards and SAM tag.
 *
 * Reduced motion (Must 6): no animation loop, no travelling lights, no bob;
 * one still frame is drawn per state change.
 *
 * The god busts (T8, Must 2, 9, 10): Zeus stands on SAM's top tier in place
 * of the diamond, each General's bust rises off its platform as a hologram,
 * and each General card carries a small bust in its top-right corner. The
 * 256 px WebP images (`src/lib/busts.ts`) are drawn additively ('lighter'),
 * so their black backgrounds vanish; brightness and Zeus's dispatch flare
 * come from `busts.ts`. Ports of e-scene.js `bust`, the Zeus branch of
 * `drawCore` and the hologram branch of `drawStation`, and of e-hybrid.html's
 * `.g-bust`. An image that fails to load leaves T7's fallback in place (the
 * diamond for SAM, the plain platform for a General).
 *
 * The clock ring (T17, Must 23, 24, 28): SAM's scheduled jobs on a 24-hour
 * dial round the top tier, polled from `/api/fleet/schedule` on the same
 * 3 s beat as the floor. Its geometry is `ringRender.ts` (pure, tested);
 * the paint is a port of e-scene.js `drawRing`, `drawLaps`, `drawFailed`
 * and `drawNumerals`: the ring right after the plinth, its travelling
 * lights with the other lights, red ticks and the numerals last, so
 * additive light cannot wash out the red and the links never cut through 12.
 * A firing job that launches a fleet job also sends its trigger light up
 * into SAM's core (T19, Must 27); the fleet job itself is drawn once, on
 * the floor, from `FloorState`.
 *
 * Extension points for later tickets: `onDrawLayer`, `onSelectGeneral` + `focus` (the dashboard shell's
 * zoom and detail, T11), `pollUrl`/`schedulePollUrl`/`demo` (demo mode, T20), `onSchedule`/`onRing` (the Schedule
 * panel and the ring's click target, T18).
 */

import { useCallback, useEffect, useRef } from 'react';

import { BUST_PATHS } from '@/lib/busts';
import type { FloorState, GeneralId, ScheduledJob } from '@/types/floor';
import { bustLevel, cardBustAlpha, currentFlare, recordFlares, workingK } from './busts';
import type { FlareLog } from './busts';
import {
  ACC, BAD, CORE, DESKTOP_OPTIONS, EDGE, FONT, GEO, KEY_ITEMS, LAPTOP_OPTIONS, LAPTOP_QUERY, MIST, PHONE_FONT, PHONE_OPTIONS,
  SPRITE_COLOURS, TEAL, bez, buildScene, camFor, clamp, computeLayout, diffFloor, ease, emptyFx, hitGeneral, iso, lerpCam,
  phoneLabels, project, rgba, toX, toY, vaultData,
} from './floorRender';
import type { BoxShape, Cam, Card, Curve, Figure, FloorFx, Layout, Pt, RGB, Scene, SpriteName, View } from './floorRender';
import {
  RING, along, beadRadius, buildRing, diamondPts, diamondSize, diffSchedule, emptyRingFx, onRing, outward, ringGeometry,
  ringVariant, tickWidth,
} from './ringRender';
import type { Box, RingFx, RingModel } from './ringRender';

export type FloorDrawLayer = 'afterPlinth' | 'afterStations' | 'afterCore' | 'top';

export interface FloorFrame {
  scene: Scene;
  layout: Layout;
  state: FloorState;
  now: number;
  reduced: boolean;
  dpr: number;
  ring: RingModel | null;
}

export interface FloorCanvasProps {
  /** Poll URL; defaults to `/api/fleet/floor`. */
  pollUrl?: string;
  /** Demo mode (T20): appends `demo=1` to the poll URL. */
  demo?: boolean;
  pollMs?: number;
  /** Called with a General's id when its station, card or pads are clicked. */
  onSelectGeneral?: (id: GeneralId) => void;
  /** Zoom the camera onto a General (null: the whole floor). */
  focus?: GeneralId | null;
  /**
   * 'auto' follows the mockup's laptop media query. 'phone' is e-phone.html's hero (T13): its scene options, no
   * worker labels, and the General names/states and SAM tag painted as the mockup's small canvas text
   * (pass showCards/showSamLabel/showKey false alongside it).
   */
  variant?: 'auto' | 'desktop' | 'laptop' | 'phone';
  /** Paint the General cards, the SAM tag and the fleet key on the canvas (default true). */
  showCards?: boolean;
  showSamLabel?: boolean;
  showKey?: boolean;
  /** Every successful poll, so a shell can share the one request. */
  onState?: (state: FloorState) => void;
  /** The clock ring's poll URL (T17); defaults to `/api/fleet/schedule`. `demo` appends `demo=1` here too. */
  schedulePollUrl?: string;
  /** Draw the clock ring (default true); false is the mockup's `?ring=off`. */
  showRing?: boolean;
  /** Every successful schedule poll (the Schedule panel, T18, can share it). */
  onSchedule?: (jobs: ScheduledJob[]) => void;
  /** The ring's extent in canvas px whenever it changes by a pixel or more (T18's click target). */
  onRing?: (extent: Box | null) => void;
  /** Hook for later tickets to paint into the scene at fixed points of the draw order. */
  onDrawLayer?: (layer: FloorDrawLayer, ctx: CanvasRenderingContext2D, frame: FloorFrame) => void;
  className?: string;
}

const TEXT = '#e8f7ee', MUTED = '#98b6a6', FAINT = '#5f7d6e';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

/* ---------- sprites (pre-rendered glows, drawn additively) ---------- */

let sprites: Record<SpriteName, HTMLCanvasElement> | null = null;
function getSprites(): Record<SpriteName, HTMLCanvasElement> {
  if (sprites) return sprites;
  const make = (col: RGB) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(240,255,244,1)'); g.addColorStop(0.14, rgba(col, 0.85)); g.addColorStop(0.42, rgba(col, 0.22)); g.addColorStop(1, rgba(col, 0));
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return c;
  };
  sprites = Object.fromEntries(Object.entries(SPRITE_COLOURS).map(([k, c]) => [k, make(c)])) as Record<SpriteName, HTMLCanvasElement>;
  return sprites;
}

/* ---------- the god busts: images, loaded once per page ---------- */

type BustId = GeneralId | 'sam';
interface BustImage { im: HTMLImageElement; halo: HTMLCanvasElement | null; ok: boolean }
const bustImages: Partial<Record<BustId, BustImage>> = {};
const bustListeners = new Set<() => void>();

/** Starts loading the six small busts (once); `onLoad` is told whenever one finishes, so a still frame can redraw. */
function ensureBusts(onLoad: () => void): () => void {
  bustListeners.add(onLoad);
  (Object.keys(BUST_PATHS) as BustId[]).forEach((id) => {
    if (bustImages[id]) return;
    const b: BustImage = { im: new Image(), halo: null, ok: false };
    bustImages[id] = b;
    b.im.decoding = 'async';
    b.im.onload = () => {
      b.ok = b.im.naturalWidth > 0;
      // a soft halo in the bust's own colours: the image squeezed to 20 px and drawn back up large (e-scene.js)
      const c = document.createElement('canvas');
      c.width = c.height = 20;
      const x = c.getContext('2d');
      if (x) { x.imageSmoothingQuality = 'high'; x.drawImage(b.im, 0, 0, 20, 20); b.halo = c; }
      bustListeners.forEach((f) => f());
    };
    b.im.onerror = () => { b.ok = false; }; // keep the fallback; never throw
    b.im.src = BUST_PATHS[id].small;
  });
  return () => { bustListeners.delete(onLoad); };
}
function bustReady(id: BustId): BustImage | null {
  const b = bustImages[id];
  return b && b.ok && b.im.complete && b.im.naturalWidth > 0 ? b : null;
}

/** What the busts need per frame: each General's brightness and Zeus's flare. */
interface BustFrame { levels: Record<GeneralId, number>; flare: number }

/* ---------- primitives ---------- */

function glow(ctx: Ctx, x: number, y: number, r: number, spr: SpriteName, a: number) {
  if (a <= 0.004 || r <= 0) return;
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(getSprites()[spr], x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function poly(ctx: Ctx, pts: Pt[], fill: string) {
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}
function paintBox(ctx: Ctx, b: BoxShape, top: string, left: string, right: string) {
  poly(ctx, b.left, left); poly(ctx, b.right, right); poly(ctx, b.top, top);
}
function neon(ctx: Ctx, a: Pt, b: Pt, col: RGB, al: number, w: number) {
  if (al <= 0.004) return;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(col, al * 0.16); ctx.lineWidth = w * 5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = rgba(col, al * 0.9); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}
function outline(ctx: Ctx, pts: Pt[], col: RGB, al: number, w: number) {
  neon(ctx, pts[0], pts[1], col, al * 0.55, w); neon(ctx, pts[1], pts[2], col, al, w);
  neon(ctx, pts[2], pts[3], col, al, w); neon(ctx, pts[3], pts[0], col, al * 0.55, w);
}
function strokeCurve(ctx: Ctx, v: View, c: Curve, t0: number, t1: number, col: RGB, al: number, w: number, off: number) {
  const n = 36; ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n, q = bez(c, t), dx = off ? Math.sin(Math.PI * t) * off : 0;
    const x = toX(v, q[0] + dx), y = toY(v, q[1]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.strokeStyle = rgba(col, al); ctx.lineWidth = w; ctx.stroke();
}
/** A link is a small bundle of fine filaments (A), blended additively so overlaps glow. */
function filament(ctx: Ctx, v: View, c: Curve, t1: number, col: RGB, al: number, lit: boolean) {
  if (al <= 0.004 || t1 <= 0) return;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  if (lit) strokeCurve(ctx, v, c, 0, t1, col, al * 0.14, 7, 0);
  strokeCurve(ctx, v, c, 0, t1, col, al * 0.7, lit ? 1.6 : 1, 0);
  strokeCurve(ctx, v, c, 0, t1, col, al * 0.32, 0.8, 7);
  strokeCurve(ctx, v, c, 0, t1, col, al * 0.26, 0.8, -6);
  ctx.globalCompositeOperation = 'source-over';
}
/** A travelling light with a tapered trail (A). */
function pulse(ctx: Ctx, v: View, c: Curve, p: number, len: number, col: RGB, spr: SpriteName, a: number, r: number, back: boolean) {
  if (a <= 0.004) return;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const n = 12, t0 = back ? Math.min(1, p + len) : Math.max(0, p - len);
  for (let i = 0; i < n; i++) {
    const ta = t0 + (p - t0) * i / n, tb = t0 + (p - t0) * (i + 1) / n, qa = bez(c, ta), qb = bez(c, tb), k = (i + 1) / n;
    ctx.strokeStyle = rgba(col, a * k * 0.9); ctx.lineWidth = 0.6 + k * 2.6;
    ctx.beginPath(); ctx.moveTo(toX(v, qa[0]), toY(v, qa[1])); ctx.lineTo(toX(v, qb[0]), toY(v, qb[1])); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const h = bez(c, p); glow(ctx, toX(v, h[0]), toY(v, h[1]), r, spr, a);
}

/** A bust whose bottom centre sits at (x, y), h px tall; lv is its brightness, glowK its halo (e-scene.js `bust`). */
function drawBust(ctx: Ctx, b: BustImage, x: number, y: number, h: number, lv: number, glowK: number): [number, number, number, number] {
  const r: [number, number, number, number] = [x - h / 2, y - h, h, h];
  ctx.globalCompositeOperation = 'lighter';
  if (glowK > 0.01 && b.halo) { ctx.globalAlpha = Math.min(1, 0.5 * glowK); ctx.drawImage(b.halo, r[0] - h * 0.14, r[1] - h * 0.1, h * 1.28, h * 1.2); }
  ctx.globalAlpha = Math.min(1, lv); ctx.drawImage(b.im, r[0], r[1], h, h);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return r;
}

/* ---------- the backdrop (cached; it only moves with the camera) ---------- */

function drawBackdrop(ctx: Ctx, v: View, layout: Layout, dpr: number) {
  const { W, H } = v, k = v.cam.k, P = (u: number, vv: number, z = 0) => project(v, u, vv, z);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#020805'); g.addColorStop(0.45, '#051510'); g.addColorStop(1, '#020705');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const c = P(0, layout.samV - 40), hg = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], Math.max(W, H) * 0.7);
  hg.addColorStop(0, 'rgba(16,185,129,.13)'); hg.addColorStop(0.5, 'rgba(6,95,70,.06)'); hg.addColorStop(1, 'rgba(6,95,70,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
  // floor grid (isometric tiles) with sparse neon accents, as on C's floor
  const TS = 58, N = 16, oy = 24, { nodes, links, neon: accents } = vaultData();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(61,255,90,.045)'; ctx.beginPath();
  for (let i = -N; i <= N; i++) {
    let a = iso(i * TS, -N * TS), b = iso(i * TS, N * TS);
    a = P(a[0], a[1] + oy); b = P(b[0], b[1] + oy); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    a = iso(-N * TS, i * TS); b = iso(N * TS, i * TS);
    a = P(a[0], a[1] + oy); b = P(b[0], b[1] + oy); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  accents.forEach((n) => {
    const x0 = n.gx * TS, y0 = n.gy * TS, x1 = n.h ? x0 + TS * n.len : x0, y1 = n.h ? y0 : y0 + TS * n.len;
    let a = iso(x0, y0), b = iso(x1, y1);
    a = P(a[0], a[1] + oy); b = P(b[0], b[1] + oy);
    const d = Math.hypot(n.gx, n.gy);
    neon(ctx, a, b, n.teal ? TEAL : CORE, 0.32 * Math.max(0.15, 1 - d / 16), 1.2);
  });
  // the knowledge vault, etched faintly into the floor
  ctx.globalCompositeOperation = 'lighter';
  [0.06, 0.1, 0.14].forEach((lv) => {
    ctx.strokeStyle = rgba(EDGE, lv * 0.9); ctx.lineWidth = 1; ctx.beginPath();
    links.forEach((l) => {
      if (Math.abs(l[2] - lv) < 0.021) {
        const a = nodes[l[0]], b = nodes[l[1]], pa = P(a.u, a.v), pb = P(b.u, b.v);
        ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
      }
    });
    ctx.stroke();
  });
  ctx.fillStyle = rgba(ACC, 0.32); ctx.beginPath();
  nodes.forEach((n) => { const p = P(n.u, n.v); ctx.moveTo(p[0] + n.r, p[1]); ctx.arc(p[0], p[1], n.r * Math.min(1.5, k), 0, 7); });
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  nodes.forEach((n) => { if (n.lit) { const p = P(n.u, n.v); glow(ctx, p[0], p[1], 12 * k, n.t ? 'teal' : 'edge', 0.45); } });
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(1,5,3,0)'); vg.addColorStop(1, 'rgba(1,5,3,.7)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

/* ---------- SAM ---------- */

function drawPlinth(ctx: Ctx, sc: Scene) {
  const p = sc.plinth, gl = p.glow;
  paintBox(ctx, p.base, '#0c2a1d', '#071a11', '#040f0a');
  paintBox(ctx, p.top, '#103523', '#0a2016', '#06140d');
  outline(ctx, p.baseRim, CORE, 0.38 + gl * 0.25, 1.2);
  outline(ctx, p.top.top, CORE, 0.5 + gl * 0.35, 1.4);
  if (p.halo && p.halo.length > 1) { // verify halo on the top tier
    ctx.strokeStyle = rgba(p.haloCol, p.haloAlpha); ctx.lineWidth = 2; ctx.beginPath();
    p.halo.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
  }
}

/**
 * SAM's node: Zeus on the top tier inside a ring (`scene.zeusSlot`), flaring on a dispatch (Must 2, 9).
 * If his image could not be loaded, the mockup's own fallback: the diamond core.
 */
function drawCore(ctx: Ctx, sc: Scene, layout: Layout, flare: number) {
  const c = sc.core, v = sc.view, k = v.cam.k, R = GEO.CORER, col = c.verifying ? TEAL : CORE;
  const z = GEO.COREZ + c.bob, vv = layout.samV, P = (u: number, w: number, zz: number) => project(v, u, w, zz);
  const zeus = bustReady('sam');
  glow(ctx, c.x, c.y, 150 * k, c.verifying ? 'teal' : 'core', zeus ? 0.12 + c.glow * 0.16 : 0.22 + c.glow * 0.3);
  if (zeus) {
    const zs = sc.zeusSlot, ring = zs.ring;
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(col, 0.35 + c.glow * 0.25); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(ring[0], ring[1], 24 * k, 14 * k, 0, 0, 7); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    glow(ctx, ring[0], ring[1], 34 * k, c.verifying ? 'teal' : 'core', 0.35);
    const r = drawBust(ctx, zeus, zs.x, zs.y, zs.heightPx, 0.9, 0.25 + c.glow * 0.15 + flare);
    if (flare > 0.01) { // the strike: the whole image again, added on top, and a burst of light behind his head
      glow(ctx, r[0] + r[2] / 2, r[1] + r[3] * 0.4, r[2] * 0.75, 'mist', 0.55 * flare);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, flare);
      ctx.drawImage(zeus.im, r[0], r[1], r[2], r[3]);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    return;
  }
  const top = P(0, vv, z + R * 1.3), bot = P(0, vv, z - R * 1.3), e1 = P(R * 1.1, vv, z), e2 = P(0, vv + R * 0.6, z), e3 = P(-R * 1.1, vv, z);
  poly(ctx, [top, e2, e1], rgba(col, 0.42)); poly(ctx, [top, e3, e2], rgba(col, 0.62));
  poly(ctx, [bot, e1, e2], rgba(col, 0.24)); poly(ctx, [bot, e2, e3], rgba(col, 0.34));
  ctx.strokeStyle = rgba(MIST, 0.85); ctx.lineWidth = 1; ctx.beginPath();
  ([[top, e1], [top, e2], [top, e3], [bot, e1], [bot, e2], [bot, e3], [e1, e2], [e2, e3]] as [Pt, Pt][])
    .forEach(([a, b]) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
  ctx.stroke();
  glow(ctx, c.x, c.y, 30 * k, 'mist', 0.55 + c.glow * 0.45);
  // light shaft from the plinth to the core
  const s0 = P(0, vv, GEO.SZ2), g = ctx.createLinearGradient(0, s0[1], 0, c.y);
  g.addColorStop(0, rgba(col, 0.22)); g.addColorStop(1, rgba(col, 0));
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(s0[0] - 9 * k, c.y, 18 * k, s0[1] - c.y);
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- a General's station ---------- */

function drawStation(ctx: Ctx, st: Scene['stations'][number], k: number, level: number) {
  paintBox(ctx, st.box, st.topFill, st.leftFill, st.rightFill);
  outline(ctx, st.box.top, st.outline, st.outlineAlpha, 1.3);
  if (st.glow) glow(ctx, st.glow.x, st.glow.y, st.glow.r, st.glow.sprite, st.glow.a);
  st.slabs.forEach((s) => { paintBox(ctx, s.box, s.top, s.left, s.right); outline(ctx, s.box.top, s.outline, s.outlineAlpha, 1); });
  st.stagePads.forEach((p) => { poly(ctx, p.quad, p.fill); if (p.glow) glow(ctx, p.glow.x, p.glow.y, p.glow.r, p.glow.sprite, p.glow.a); });
  const b = bustReady(st.id);
  if (b) { // the hologram: an emitter ring on the platform, a faint beam, and the bust rising out of it (Must 2, 10)
    const bs = st.bustSlot, em = bs.emitter, h = bs.heightPx, wk = workingK(level);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(CORE, 0.12 + 0.4 * wk); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(em[0], em[1], 20 * k, 11 * k, 0, 0, 7); ctx.stroke();
    const bh = h * 0.55, gr = ctx.createLinearGradient(0, em[1] - bh, 0, em[1]);
    gr.addColorStop(0, rgba(CORE, 0)); gr.addColorStop(1, rgba(CORE, 0.05 + 0.12 * wk));
    ctx.fillStyle = gr; ctx.beginPath();
    ctx.moveTo(em[0] - 20 * k, em[1]); ctx.lineTo(em[0] + 20 * k, em[1]); ctx.lineTo(em[0] + 30 * k, em[1] - bh); ctx.lineTo(em[0] - 30 * k, em[1] - bh);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (wk > 0.01) glow(ctx, bs.x, bs.y - h * 0.45, h * 0.75, 'core', 0.16 * wk);
    drawBust(ctx, b, bs.x, bs.y, h, level, wk);
  }
}

/* ---------- workers ---------- */

function drawPad(ctx: Ctx, pad: Scene['pads'][number]) {
  const t = pad.box;
  paintBox(ctx, t, pad.lit ? rgba(EDGE, 0.22 + 0.2 * pad.a) : 'rgba(10,34,24,.55)', '#05130c', '#030b07');
  if (pad.lit) outline(ctx, t.top, CORE, 0.35 + 0.5 * pad.a, 1);
  else {
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(61,255,90,.16)'; ctx.lineWidth = 1; ctx.beginPath();
    t.top.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawFigure(ctx: Ctx, w: Figure, time: number, reduced: boolean) {
  if (w.vis <= 0) return; // still waiting for its dispatch pulse to arrive
  const p: Pt = [w.x, w.y], k = w.k, col = w.col, spawn = w.spawnK, dying = w.dying;
  const spr: SpriteName = w.failed ? 'bad' : col === TEAL ? 'teal' : 'core';
  // spawn: a ripple on the pad and a column of light that shoots up, then the figure rises into it
  if (spawn < 1 && !reduced) {
    const r = (8 + 34 * ease(spawn)) * k; ctx.strokeStyle = rgba(col, 0.9 * (1 - spawn)); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(p[0], p[1], r, r * 0.58, 0, 0, 7); ctx.stroke();
    glow(ctx, p[0], p[1] - 20 * k, 70 * k, spr, 0.6 * (1 - spawn));
  }
  const colH = (w.active ? 118 : 0) * k + (spawn < 1 ? 150 * k * Math.sin(Math.PI * Math.min(1, spawn * 1.2)) : 0);
  if (colH > 0) {
    const g = ctx.createLinearGradient(0, p[1] - colH, 0, p[1]);
    g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, (w.active ? 0.3 : 0) + (spawn < 1 ? 0.45 * (1 - spawn) : 0)));
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(p[0] - 11 * k, p[1] - colH, 22 * k, colH);
    ctx.globalCompositeOperation = 'source-over';
  }
  const vis = w.vis;
  const a = vis * (w.returned ? 0.6 : 1) * (1 - dying);
  if (a <= 0.01) return;
  const bh = 22 * k, bw = 6.8 * k, hr = 5.6 * k, lift = (1 - vis) * 18 * k + dying * -6 * k, y0 = p[1] - 2 * k - lift;
  const dark1 = w.failed ? '#6b2a24' : '#1f6b4c', dark2 = w.failed ? '#2a0f0c' : '#0b2a1d', dark3 = w.failed ? '#3a1612' : '#0d3a27';
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(p[0], p[1], 10 * k, 5 * k, 0, 0, 7); ctx.fill();
  const g2 = ctx.createLinearGradient(p[0] - bw, 0, p[0] + bw, 0);
  g2.addColorStop(0, rgba(col, 0.95)); g2.addColorStop(0.55, dark1); g2.addColorStop(1, dark2);
  ctx.fillStyle = g2; ctx.beginPath(); ctx.roundRect(p[0] - bw, y0 - bh, bw * 2, bh, bw); ctx.fill();
  const g3 = ctx.createRadialGradient(p[0] - hr * 0.4, y0 - bh - hr * 1.6, 0, p[0], y0 - bh - hr * 1.3, hr * 1.3);
  g3.addColorStop(0, 'rgba(240,255,244,1)'); g3.addColorStop(0.5, rgba(col, 1)); g3.addColorStop(1, dark3);
  ctx.fillStyle = g3; ctx.beginPath(); ctx.arc(p[0], y0 - bh - hr * 1.2, hr, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  if (w.active && !reduced) { const pl = 0.5 + 0.5 * Math.sin(time * 4 + w.i * 2); glow(ctx, p[0], y0 - bh * 0.5, 22 * k, spr, 0.22 + 0.2 * pl); }
}

function fitText(ctx: Ctx, t: string, max: number): string {
  if (ctx.measureText(t).width <= max) return t;
  while (t.length > 3 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
/** A label that does not fit wraps onto a second line rather than being cut short. */
function wrap(ctx: Ctx, t: string, max: number): string[] {
  if (ctx.measureText(t).width <= max) return [t];
  const words = t.split(' ');
  let a = words.shift() ?? '';
  while (words.length && ctx.measureText(a + ' ' + words[0]).width <= max) a += ' ' + words.shift();
  return words.length ? [fitText(ctx, a, max), fitText(ctx, words.join(' '), max)] : [fitText(ctx, a, max)];
}

function workerLabel(ctx: Ctx, w: Figure, sc: Scene, layout: Layout) {
  if (!w.label) return;
  const kk = Math.min(1.25, sc.view.cam.k / layout.s), minF = layout.opts.minFont;
  const f1 = Math.max(11 * kk, minF), f2 = Math.max(10 * kk, minF), lh = 1.3 * f2, max = Math.max(40, w.label.maxW);
  const font1 = `600 ${f1.toFixed(1)}px ${FONT}`, font2 = `500 ${f2.toFixed(1)}px ${FONT}`;
  ctx.font = font1; const w1 = ctx.measureText(w.label.line1).width;
  ctx.font = font2; const lines = wrap(ctx, w.label.line2, max);
  const wd = Math.max(w1, ...lines.map((l) => ctx.measureText(l).width));
  const px = w.lx, py = w.ly, bot = py + f1 + lh * lines.length + f2 * 0.3;
  if (px - wd / 2 < 2 || px + wd / 2 > sc.view.W - 2 || bot > sc.view.H) return; // half off screen: leave it out
  const vis = w.vis;
  ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(1,6,3,.95)'; ctx.shadowBlur = 6;
  ctx.font = font1; ctx.fillStyle = w.failed ? rgba(BAD, 0.95 * vis) : `rgba(226,255,234,${(0.95 * vis).toFixed(3)})`;
  ctx.fillText(w.label.line1, px, py + f1);
  ctx.font = font2;
  ctx.fillStyle = w.failed ? rgba(BAD, 0.8 * vis) : w.active ? `rgba(157,255,112,${vis.toFixed(3)})` : `rgba(140,175,158,${(0.9 * vis).toFixed(3)})`;
  lines.forEach((l, j) => ctx.fillText(l, px, py + f1 + lh * (j + 1)));
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
}

/* ---------- labels: the General cards, the SAM tag, the fleet key (the mockup's DOM, painted) ---------- */

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

function drawCard(ctx: Ctx, c: Card, W: number, id: GeneralId, level: number) {
  if (c.x < 2 || c.x + c.w > W - 2) return; // a card the zoom pushes part-way off the scene is left out
  const k = c.k, pad = 11 * k, x = c.x, y = c.y;
  const bust = bustReady(id), bustPad = bust ? 36 * k : 0; // e-hybrid.html: .g-top, .g-role {padding-right:36px}
  ctx.save();
  if (c.busy) { ctx.shadowColor = 'rgba(61,255,90,.35)'; ctx.shadowBlur = 28 * k; ctx.shadowOffsetY = 10 * k; }
  roundRect(ctx, x, y, c.w, c.h, 10 * k); ctx.fillStyle = 'rgba(5,19,13,.84)'; ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, c.w - 1, c.h - 1, 10 * k);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.hover ? 'rgba(157,255,112,.34)' : c.busy ? 'rgba(61,255,90,.34)' : 'rgba(157,255,112,.16)';
  ctx.stroke();
  const inner = c.w - pad * 2;
  // the small bust in the top-right corner: 45% idle, full working, screen-blended as in the mockup's DOM card
  if (bust) {
    const s = 38 * k;
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = cardBustAlpha(level);
    ctx.drawImage(bust.im, x + c.w - 6 * k - s, y + 5 * k, s, s);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  // name and jobs-today count
  ctx.font = `500 ${(11 * k).toFixed(1)}px ${FONT}`;
  const cw = ctx.measureText(c.count).width;
  ctx.fillStyle = FAINT; ctx.textAlign = 'right'; ctx.fillText(c.count, x + c.w - pad - bustPad, y + 22 * k);
  ctx.textAlign = 'left'; ctx.font = `600 ${(13.5 * k).toFixed(1)}px ${FONT}`; ctx.fillStyle = TEXT;
  ctx.fillText(fitText(ctx, c.name, inner - bustPad - cw - 6 * k), x + pad, y + 22 * k);
  // role
  ctx.letterSpacing = `${(0.09 * 11 * k).toFixed(2)}px`;
  ctx.font = `500 ${(11 * k).toFixed(1)}px ${FONT}`; ctx.fillStyle = FAINT;
  ctx.fillText(fitText(ctx, c.role.toUpperCase(), inner - bustPad), x + pad, y + 37 * k);
  ctx.letterSpacing = '0px';
  // state, with the live dot when busy
  ctx.font = `400 ${(11 * k).toFixed(1)}px ${FONT}`;
  let sx = x + pad;
  if (c.busy) {
    ctx.save(); ctx.shadowColor = '#3dff5a'; ctx.shadowBlur = 6 * k;
    ctx.fillStyle = '#3dff5a'; ctx.beginPath(); ctx.arc(sx + 3 * k, y + 50.5 * k, 3 * k, 0, 7); ctx.fill(); ctx.restore();
    sx += 12 * k;
  }
  ctx.fillStyle = c.busy ? MUTED : FAINT;
  ctx.fillText(fitText(ctx, c.state, x + c.w - pad - sx), sx, y + 54 * k);
  // stage segments
  const n = Math.max(1, c.segs.length), gap = 3 * k, sw = (inner - gap * (n - 1)) / n, sy = y + 63 * k;
  c.segs.forEach((s, i) => {
    const fill = s === 'done' ? '#9dff70' : s === 'now' ? '#3dff5a' : s === 'ver' ? '#2dd4bf' : s === 'bad' ? '#ff7a70' : 'rgba(157,255,112,.1)';
    ctx.save();
    if (s === 'now' || s === 'ver') { ctx.shadowColor = fill; ctx.shadowBlur = 8 * k; }
    roundRect(ctx, x + pad + i * (sw + gap), sy, sw, 3 * k, 2 * k); ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
  });
}

function drawSamLabel(ctx: Ctx, sc: Scene) {
  const { x, y, state } = sc.samLabel;
  ctx.save();
  ctx.shadowColor = 'rgba(1,6,3,.95)'; ctx.shadowBlur = 8; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${(0.14 * 16).toFixed(2)}px`; ctx.font = `700 16px ${FONT}`; ctx.fillStyle = TEXT; ctx.fillText('SAM', x, y + 15);
  ctx.letterSpacing = `${(0.12 * 11).toFixed(2)}px`; ctx.font = `600 11px ${FONT}`; ctx.fillStyle = '#3dff5a'; ctx.fillText('ORCHESTRATOR', x, y + 30);
  ctx.letterSpacing = '0px'; ctx.font = `400 11.5px ${FONT}`; ctx.fillStyle = MUTED; ctx.fillText(state, x, y + 45);
  ctx.restore();
}

function drawKey(ctx: Ctx, laptop: boolean) {
  const x = 18;
  let y = 14;
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${(0.12 * 11).toFixed(2)}px`; ctx.font = `600 11px ${FONT}`; ctx.fillStyle = MUTED;
  ctx.fillText('FLEET', x, y + 7);
  ctx.letterSpacing = '0px';
  y += 14 + 8;
  ctx.font = `400 11px ${FONT}`;
  for (const item of KEY_ITEMS) {
    if (item.optional && laptop) continue;
    const cy = y + 7;
    ctx.save();
    if (item.icon === 'link') { ctx.shadowColor = '#3dff5a'; ctx.shadowBlur = 6; ctx.fillStyle = '#3dff5a'; roundRect(ctx, x, cy - 1, 14, 2, 1); ctx.fill(); }
    else if (item.icon === 'figure') {
      const g = ctx.createLinearGradient(0, cy - 5, 0, cy + 5); g.addColorStop(0, '#e2ffea'); g.addColorStop(1, '#3dff5a');
      ctx.shadowColor = 'rgba(61,255,90,.6)'; ctx.shadowBlur = 6; ctx.fillStyle = g; roundRect(ctx, x + 4.5, cy - 5, 5, 10, 3); ctx.fill();
    } else if (item.icon === 'slab') {
      ctx.translate(x + 7, cy); ctx.rotate(Math.PI / 4); ctx.scale(0.8, 0.8);
      ctx.fillStyle = 'rgba(16,185,129,.35)'; ctx.fillRect(-4, -4, 8, 8); ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1; ctx.strokeRect(-4, -4, 8, 8);
    } else if (item.icon === 'vault') { ctx.fillStyle = 'rgba(16,185,129,.55)'; ctx.beginPath(); ctx.arc(x + 7, cy, 3, 0, 7); ctx.fill(); }
    else if (item.icon === 'ring') { ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x + 7, cy, 7, 3.5, 0, 0, 7); ctx.stroke(); }
    else if (item.icon === 'diamond') {
      ctx.translate(x + 7, cy); ctx.rotate(Math.PI / 4); ctx.strokeStyle = '#9dff70'; ctx.lineWidth = 1.2; ctx.strokeRect(-3, -3, 6, 6);
    }
    ctx.restore();
    ctx.fillStyle = FAINT; ctx.fillText(item.text, x + 20, cy);
    if (item.then) { // e-hybrid.html's `<i class="b">`: a small bead 8 px after the words, then its own words
      const bx = x + 20 + ctx.measureText(item.text).width + 8 + 2.5;
      ctx.fillStyle = '#9dff70'; ctx.beginPath(); ctx.arc(bx, cy, 2.5, 0, 7); ctx.fill();
      ctx.fillStyle = FAINT; ctx.fillText(item.then.text, bx + 2.5 + 6, cy);
    }
    y += 14 + 5;
  }
  ctx.restore();
}

/** e-phone.html `labels`: each General's name and state under its station, and SAM / ORCHESTRATOR beside Zeus (T13). */
function drawPhoneLabels(ctx: Ctx, sc: Scene, layout: Layout, state: FloorState) {
  const pl = phoneLabels(sc, layout, state, !!bustReady('sam'));
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(1,6,3,.95)'; ctx.shadowBlur = 6;
  pl.generals.forEach((g) => {
    ctx.font = `600 10.5px ${PHONE_FONT}`; ctx.fillStyle = g.busy ? '#effff3' : '#a7c4b4'; ctx.fillText(g.name, g.x, g.y + 10);
    ctx.font = `500 9px ${PHONE_FONT}`; ctx.fillStyle = g.busy ? 'rgba(157,255,112,1)' : '#5f7d6e'; ctx.fillText(g.state, g.x, g.y + 22);
  });
  ctx.textAlign = 'left';
  ctx.font = `700 12px ${PHONE_FONT}`; ctx.fillStyle = '#effff3'; ctx.fillText('SAM', pl.sam.x, pl.sam.y - 2);
  ctx.font = `600 8.5px ${PHONE_FONT}`; ctx.fillStyle = 'rgba(61,255,90,.95)'; ctx.fillText('ORCHESTRATOR', pl.sam.x, pl.sam.y + 9);
  ctx.restore();
}

/* ---------- the clock ring (T17; geometry in ringRender.ts) ---------- */

/** The dial, its 24 hour marks, the inner track with its minute notch, the now hand and every mark (port of `drawRing`). */
function drawRing(ctx: Ctx, rm: RingModel) {
  const g = rm.geo, px = g.px, k = g.k;
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the track: a soft band and a fine line, with 24 short hour marks inside it (the quarters a little longer)
  ctx.strokeStyle = rgba(EDGE, 0.07); ctx.lineWidth = 5 * px; ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = rgba(EDGE, 0.38); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = rgba(EDGE, 0.3); ctx.beginPath();
  for (let h = 0; h < 24; h++) {
    const a = (h / 24) * Math.PI * 2, p0 = onRing(g, a, 1), p1 = along(p0, outward(g, a), h % 6 ? -3 : -5);
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
  }
  ctx.stroke();
  // the inner track for the hourly-or-faster jobs: one hour round, with a notch at the minute
  ctx.strokeStyle = rgba(EDGE, 0.17); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx * RING.INNER, g.ry * RING.INNER, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = rgba(MIST, 0.5); ctx.lineWidth = 1.6 * px; ctx.beginPath();
  for (let i = 0; i <= 6; i++) { const q = onRing(g, rm.minuteAngle - 0.09 + 0.03 * i, RING.INNER); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
  ctx.stroke();
  // the now hand: faint, from just outside Zeus's own ring to the track
  const h0 = onRing(g, rm.handAngle, 0.36), h1 = onRing(g, rm.handAngle, 1.05);
  const hg = ctx.createLinearGradient(h0[0], h0[1], h1[0], h1[1]); hg.addColorStop(0, rgba(MIST, 0)); hg.addColorStop(1, rgba(MIST, 0.42));
  ctx.strokeStyle = hg; ctx.lineWidth = 1.2 * px; ctx.beginPath(); ctx.moveTo(h0[0], h0[1]); ctx.lineTo(h1[0], h1[1]); ctx.stroke();
  const rb = beadRadius(g), lw = tickWidth(g);
  const shine = (p: Pt, gl: number, firing: boolean, lap: number | null) => {
    if (gl <= 0.02) return;
    glow(ctx, p[0], p[1], Math.max(7, 13 * k), 'acc', 0.5 * gl);
    if (firing) glow(ctx, p[0], p[1], Math.max(10, 20 * k), 'mist', 0.55 * (1 - (lap ?? 0) * 0.6));
    ctx.globalCompositeOperation = 'lighter';
  };
  for (const m of rm.marks) {
    if (m.state === 'failed') continue; // red, last
    const gl = m.glow, lit = gl > 0.02, firing = m.state === 'firing';
    ctx.globalCompositeOperation = 'lighter';
    if (m.shape === 'bead') {
      ctx.fillStyle = lit ? rgba(MIST, 0.6 + 0.4 * gl) : rgba(ACC, 0.62);
      ctx.beginPath(); ctx.arc(m.xy[0], m.xy[1], lit ? rb * 1.25 : rb, 0, 7); ctx.fill();
      shine(m.xy, gl, firing, m.lap);
      continue;
    }
    const n = outward(g, m.angle), p0 = onRing(g, m.angle, 1);
    if (m.shape === 'diamond') { // hollow when idle, filled while lit, dim when its run is over 24 h away
      const dm = diamondPts(m.xy, n, diamondSize(g));
      ctx.strokeStyle = lit ? rgba(MIST, 0.6 + 0.4 * gl) : rgba(ACC, m.dim ? 0.3 : 0.72); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(dm[0][0], dm[0][1]); ctx.moveTo(dm[0][0], dm[0][1]);
      dm.forEach((q) => ctx.lineTo(q[0], q[1])); ctx.closePath(); ctx.stroke();
      if (lit) { ctx.fillStyle = rgba(MIST, 0.5 + 0.4 * gl); ctx.beginPath(); dm.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); }
      shine(m.xy, gl, firing, m.lap);
      continue;
    }
    // a line tick (daily, or every few hours); it lengthens while lit
    const p1 = along(p0, n, (m.xy[0] - p0[0]) * n[0] * 2 + (m.xy[1] - p0[1]) * n[1] * 2);
    ctx.strokeStyle = lit ? rgba(MIST, 0.55 + 0.45 * gl) : rgba(ACC, m.dim ? 0.26 : 0.66); ctx.lineWidth = (lit ? 2 : 1.5) * Math.max(1, px);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    shine(m.xy, gl, firing, m.lap);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.lineJoin = 'miter';
}

/** The light that runs once round its track from a firing mark (A's travelling light: tapered trail, additive; port of `drawLaps`). */
function drawLaps(ctx: Ctx, rm: RingModel) {
  const g = rm.geo, k = g.k;
  rm.laps.forEach((l) => {
    const p = ease(l.p), head = l.a + p * Math.PI * 2, tail = Math.max(l.a, head - Math.PI * 0.55);
    const fade = Math.min(1, l.p * 8) * Math.min(1, (1 - l.p) * 4), n = 14;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const aa = tail + ((head - tail) * i) / n, ab = tail + ((head - tail) * (i + 1)) / n, qa = onRing(g, aa, l.f), qb = onRing(g, ab, l.f), kk = (i + 1) / n;
      ctx.strokeStyle = rgba(ACC, 0.8 * fade * kk); ctx.lineWidth = 0.5 + kk * 1.8 * Math.max(0.7, k);
      ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const q = onRing(g, head, l.f); glow(ctx, q[0], q[1], Math.max(8, 13 * k), 'mist', 0.75 * fade);
  });
}

/** A scheduled dispatch's trigger: a light rising from its mark into SAM's core, in canvas px (T19; the mockup's request pulse from a tick). */
function drawTriggers(ctx: Ctx, rm: RingModel) {
  const k = rm.geo.k, n = 12, len = 0.35;
  rm.triggers.forEach((tr) => {
    const p = ease(tr.p), t0 = Math.max(0, p - len), a = 0.9;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const qa = bez(tr.curve, t0 + ((p - t0) * i) / n), qb = bez(tr.curve, t0 + ((p - t0) * (i + 1)) / n), kk = (i + 1) / n;
      ctx.strokeStyle = rgba(ACC, a * kk * 0.9); ctx.lineWidth = 0.6 + kk * 2.6;
      ctx.beginPath(); ctx.moveTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const h = bez(tr.curve, p); glow(ctx, h[0], h[1], 22 * k, 'acc', a);
  });
}

/** A failed last run in status red, drawn over the additive light (port of `drawFailed`, for every shape). */
function drawFailed(ctx: Ctx, rm: RingModel) {
  const g = rm.geo, k = g.k;
  ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'round'; ctx.strokeStyle = rgba(BAD, 0.95); ctx.fillStyle = rgba(BAD, 0.95);
  for (const m of rm.marks) {
    if (m.state !== 'failed') continue;
    if (m.shape === 'bead') { ctx.beginPath(); ctx.arc(m.xy[0], m.xy[1], beadRadius(g), 0, 7); ctx.fill(); continue; }
    const n = outward(g, m.angle), p0 = onRing(g, m.angle, 1);
    if (m.shape === 'diamond') {
      const dm = diamondPts(m.xy, n, diamondSize(g));
      ctx.lineWidth = tickWidth(g); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(dm[0][0], dm[0][1]); ctx.stroke();
      ctx.beginPath(); dm.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill();
      continue;
    }
    const p1 = along(p0, n, g.len);
    ctx.lineWidth = Math.max(1.6, 2 * k); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(p1[0], p1[1], Math.max(1.3, 2 * k), 0, 7); ctx.fill();
  }
}

/** 00, 06, 12 and 18, over the links that cross the front of the dial, with the labels' dark shadow (port of `drawNumerals`). */
function drawNumerals(ctx: Ctx, rm: RingModel, font: string) {
  const g = rm.geo;
  ctx.save();
  ctx.font = `600 ${g.numPx}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(1,6,3,.95)'; ctx.shadowBlur = 5;
  ctx.fillStyle = 'rgba(176,206,190,.9)';
  g.nums.forEach((nm) => ctx.fillText(nm.t, nm.r[0] + nm.r[2] / 2, nm.r[1] + nm.r[3] / 2 + 0.5));
  ctx.restore();
}

/* ---------- the frame ---------- */

function paint(
  ctx: Ctx, cache: HTMLCanvasElement, cacheKey: { v: string }, sc: Scene, state: FloorState, layout: Layout,
  now: number, reduced: boolean, dpr: number, flags: { cards: boolean; sam: boolean; key: boolean; phone: boolean },
  busts: BustFrame, ring: RingModel | null, onDrawLayer?: FloorCanvasProps['onDrawLayer'],
) {
  const v = sc.view, time = now / 1000;
  const key = [v.cam.x, v.cam.y, v.cam.k, v.W, v.H, dpr].map((x) => x.toFixed(3)).join();
  if (key !== cacheKey.v) {
    cacheKey.v = key;
    if (cache.width !== ctx.canvas.width || cache.height !== ctx.canvas.height) { cache.width = ctx.canvas.width; cache.height = ctx.canvas.height; }
    const cx = cache.getContext('2d') as Ctx | null;
    if (cx) drawBackdrop(cx, v, layout, dpr);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'copy'; ctx.drawImage(cache, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const frame: FloorFrame = { scene: sc, layout, state, now, reduced, dpr, ring };
  const layer = (l: FloorDrawLayer) => { if (onDrawLayer) { ctx.save(); onDrawLayer(l, ctx, frame); ctx.restore(); } };
  // 1. SAM's plinth, then the idle filaments pouring down from the core to every General
  drawPlinth(ctx, sc);
  if (ring) drawRing(ctx, ring);
  layer('afterPlinth');
  sc.baseLinks.forEach((f) => filament(ctx, v, f.curve, f.t1, f.col, f.alpha, f.lit));
  // 2. stations
  sc.stations.forEach((st) => drawStation(ctx, st, v.cam.k, busts.levels[st.id]));
  layer('afterStations');
  // 3. lit routes
  sc.litLinks.forEach((f) => filament(ctx, v, f.curve, f.t1, f.col, f.alpha, f.lit));
  // 4. SAM's node over the filaments
  drawCore(ctx, sc, layout, busts.flare);
  layer('afterCore');
  // 5. worker pads, figures and their labels
  sc.pads.forEach((p) => drawPad(ctx, p));
  sc.figures.forEach((f) => drawFigure(ctx, f, time, reduced));
  if (!flags.phone) sc.figures.forEach((f) => { if (f.dying < 0.6) workerLabel(ctx, f, sc, layout); });
  // 6. lights travelling along the links (none under reduced motion: buildScene returns none)
  if (!reduced) sc.pulses.forEach((p) => pulse(ctx, v, p.curve, p.p, p.len, p.col, p.sprite, p.alpha, p.r, p.back));
  if (ring && !reduced) { drawLaps(ctx, ring); drawTriggers(ctx, ring); }
  // the ring's red ticks and numerals last, over the additive light and the links
  if (ring) { drawFailed(ctx, ring); drawNumerals(ctx, ring, FONT); }
  // 7. labels
  if (flags.cards) sc.stations.forEach((st) => drawCard(ctx, st.card, v.W, st.id, busts.levels[st.id]));
  if (flags.sam) drawSamLabel(ctx, sc);
  if (flags.key) drawKey(ctx, layout.opts.laptop);
  if (flags.phone) drawPhoneLabels(ctx, sc, layout, state);
  layer('top');
}

function isFloorState(x: unknown): x is FloorState {
  const r = x as FloorState | null;
  return !!r && typeof r === 'object' && !!r.generals && typeof r.generals === 'object' && !!r.towers;
}

export default function FloorCanvas({
  pollUrl = '/api/fleet/floor', demo = false, pollMs = 3000, onSelectGeneral, focus = null, variant = 'auto',
  showCards = true, showSamLabel = true, showKey = true, onState, onDrawLayer, className,
  schedulePollUrl = '/api/fleet/schedule', showRing = true, onSchedule, onRing,
}: FloorCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef({
    state: null as FloorState | null,
    fx: emptyFx() as FloorFx,
    layout: null as Layout | null,
    dpr: 1,
    reduced: false,
    hover: null as GeneralId | null,
    view: { from: null as GeneralId | null, to: null as GeneralId | null, t0: 0 },
    cache: null as HTMLCanvasElement | null,
    cacheKey: { v: '' },
    raf: 0,
    laptop: false,
    /** Zeus's flares: jobId → when its dispatch landed (Must 9: once per job, never on the first poll). */
    flares: {} as FlareLog,
    /** The clock ring (T17): the last schedule poll, which jobs fired when, and the displayed (eased) angles. */
    jobs: null as ScheduledJob[] | null,
    ringFx: emptyRingFx() as RingFx,
    ringAngles: {} as Record<string, number>,
    ringT: 0,
    ringExtent: null as Box | null,
  });
  const props = useRef({ onSelectGeneral, onState, onDrawLayer, showCards, showSamLabel, showKey, variant, showRing, onSchedule, onRing });
  props.current = { onSelectGeneral, onState, onDrawLayer, showCards, showSamLabel, showKey, variant, showRing, onSchedule, onRing };

  const camNow = useCallback((now: number): Cam | null => {
    const s = st.current, L = s.layout;
    if (!L) return null;
    const e = s.reduced ? 1 : clamp((now - s.view.t0) / 950, 0, 1);
    return lerpCam(camFor(L, s.view.from), camFor(L, s.view.to), ease(e));
  }, []);

  const draw = useCallback((now: number) => {
    const s = st.current, cv = canvasRef.current, L = s.layout;
    if (!cv || !L || !s.state) return;
    const ctx = cv.getContext('2d') as Ctx | null;
    if (!ctx) return;
    if (!s.cache) s.cache = document.createElement('canvas');
    const cam = camNow(now) ?? L.home;
    const wall = Date.now();
    const sc = buildScene(s.state, L, { now: wall, fx: s.fx, reduced: s.reduced, hover: s.hover, cam });
    const p = props.current;
    // bust brightness follows each station's Idle/Working state, with the 0.3 s ramp from the flip (static when reduced)
    const levels = {} as Record<GeneralId, number>;
    sc.stations.forEach((x) => {
      const flip = s.fx.idleFlips[x.id];
      levels[x.id] = bustLevel(x.idle, flip == null ? Infinity : Math.max(0, wall - flip), s.reduced);
    });
    const busts: BustFrame = { levels, flare: currentFlare(s.flares, wall, s.reduced) };
    // the clock ring: the dial follows the camera; ticks glide on to their next run (exact under reduced motion)
    let ring: RingModel | null = null;
    if (p.showRing && s.jobs) {
      const dt = s.ringT ? Math.min(0.25, (now - s.ringT) / 1000) : 0;
      s.ringT = now;
      const smooth = (id: string, a: number) => {
        const d = s.ringAngles[id];
        if (d == null || s.reduced) return (s.ringAngles[id] = a);
        let diff = a - d; diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
        return (s.ringAngles[id] = d + (Math.abs(diff) < 1e-4 ? diff : diff * (1 - Math.exp(-dt / 0.12))));
      };
      const geo = ringGeometry(L, cam, !!bustReady('sam'));
      ring = buildRing(s.jobs, geo, { now: wall, fx: s.ringFx, reduced: s.reduced, variant: ringVariant(p.variant === 'phone', s.laptop), smooth });
    }
    const ext = ring ? ring.extent : null, prev = s.ringExtent;
    if (!ext !== !prev || (ext && prev && ext.some((x, i) => Math.abs(x - prev[i]) >= 1))) { s.ringExtent = ext; p.onRing?.(ext); }
    paint(ctx, s.cache, s.cacheKey, sc, s.state, L, wall, s.reduced, s.dpr,
      { cards: p.showCards, sam: p.showSamLabel, key: p.showKey, phone: p.variant === 'phone' }, busts, ring, p.onDrawLayer);
  }, [camNow]);

  const drawOnce = useCallback(() => { draw(performance.now()); }, [draw]);

  const startLoop = useCallback(() => {
    const s = st.current;
    if (s.raf || s.reduced) return;
    const tick = (t: number) => { s.raf = requestAnimationFrame(tick); draw(t); };
    s.raf = requestAnimationFrame(tick);
  }, [draw]);
  const stopLoop = useCallback(() => {
    const s = st.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = 0;
  }, []);

  // size to the container, at the device pixel ratio
  const relayout = useCallback(() => {
    const s = st.current, cv = canvasRef.current, wrapEl = wrapRef.current;
    if (!cv || !wrapEl) return;
    const r = wrapEl.getBoundingClientRect();
    const v = props.current.variant;
    const phone = v === 'phone';
    s.laptop = v === 'laptop' || (v === 'auto' && typeof window !== 'undefined' && window.matchMedia(LAPTOP_QUERY).matches);
    s.dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(r.width * s.dpr));
    cv.height = Math.max(1, Math.round(r.height * s.dpr));
    s.cacheKey.v = '';
    s.layout = computeLayout(r.width, r.height, phone ? PHONE_OPTIONS : s.laptop ? LAPTOP_OPTIONS : DESKTOP_OPTIONS);
    if (s.reduced) drawOnce();
  }, [drawOnce]);

  useEffect(() => {
    const wrapEl = wrapRef.current;
    if (!wrapEl) return;
    relayout();
    const ro = new ResizeObserver(() => relayout());
    ro.observe(wrapEl);
    const lq = window.matchMedia(LAPTOP_QUERY);
    const onLq = () => relayout();
    lq.addEventListener('change', onLq);
    // reduced motion: no loop, a still frame per change (Must 6)
    const rq = window.matchMedia(REDUCED_QUERY);
    const applyReduced = () => {
      st.current.reduced = rq.matches;
      if (rq.matches) { stopLoop(); drawOnce(); } else startLoop();
    };
    applyReduced();
    rq.addEventListener('change', applyReduced);
    return () => {
      ro.disconnect(); lq.removeEventListener('change', onLq); rq.removeEventListener('change', applyReduced); stopLoop();
    };
  }, [relayout, startLoop, stopLoop, drawOnce]);

  useEffect(() => { relayout(); }, [variant, relayout]);
  // load the busts; a still frame (reduced motion) redraws as each arrives
  useEffect(() => ensureBusts(() => { if (st.current.reduced) drawOnce(); }), [drawOnce]);
  useEffect(() => { if (st.current.reduced) drawOnce(); }, [showCards, showSamLabel, showKey, showRing, drawOnce]);

  // the zoom
  useEffect(() => {
    const s = st.current, now = performance.now(), next = focus ?? null;
    if (next === s.view.to) return;
    s.view = { from: s.view.to, to: next, t0: now };
    if (s.reduced) drawOnce();
  }, [focus, drawOnce]);

  // poll the floor every few seconds (Must 13)
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | null = null, ctl: AbortController | null = null;
    const url = demo ? pollUrl + (pollUrl.includes('?') ? '&' : '?') + 'demo=1' : pollUrl;
    const poll = async () => {
      ctl = new AbortController();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        if (res.ok) {
          const json = (await res.json()) as { data?: unknown };
          if (!stopped && isFloorState(json.data)) {
            const s = st.current, next = json.data, wall = Date.now();
            s.flares = recordFlares(s.flares, next.dispatchFlares, wall, s.state === null);
            s.fx = diffFloor(s.state, next, wall, s.fx);
            s.state = next;
            props.current.onState?.(next);
            if (s.reduced) drawOnce();
          }
        }
      } catch {
        // keep the last good state; the next poll tries again
      }
      if (!stopped) timer = setTimeout(poll, pollMs);
    };
    st.current.fx = emptyFx();
    st.current.state = null;
    st.current.flares = {};
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); ctl?.abort(); };
  }, [pollUrl, demo, pollMs, drawOnce]);

  // poll the schedule on the same beat, so ring changes show within 5 s (Must 28)
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | null = null, ctl: AbortController | null = null;
    const url = demo ? schedulePollUrl + (schedulePollUrl.includes('?') ? '&' : '?') + 'demo=1' : schedulePollUrl;
    const poll = async () => {
      ctl = new AbortController();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        if (res.ok) {
          const json = (await res.json()) as { data?: unknown };
          if (!stopped && Array.isArray(json.data)) {
            const s = st.current, next = json.data as ScheduledJob[];
            s.ringFx = diffSchedule(s.jobs, next, Date.now(), s.ringFx);
            s.jobs = next;
            props.current.onSchedule?.(next);
            if (s.reduced) drawOnce();
          }
        }
      } catch {
        // keep the last good schedule; the next poll tries again
      }
      if (!stopped) timer = setTimeout(poll, pollMs);
    };
    st.current.jobs = null;
    st.current.ringFx = emptyRingFx();
    st.current.ringAngles = {};
    if (showRing) void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); ctl?.abort(); };
  }, [schedulePollUrl, demo, pollMs, showRing, drawOnce]);

  const localPoint = (e: React.PointerEvent | React.MouseEvent): Pt | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const hitAt = (e: React.PointerEvent | React.MouseEvent): GeneralId | null => {
    const s = st.current, p = localPoint(e), cam = camNow(performance.now());
    if (!p || !s.layout || !cam) return null;
    return hitGeneral(s.layout, cam, p[0], p[1]);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const id = hitAt(e), s = st.current;
    if (id === s.hover) return;
    s.hover = id;
    if (canvasRef.current) canvasRef.current.style.cursor = id && props.current.onSelectGeneral ? 'pointer' : 'default';
    if (s.reduced) drawOnce();
  };
  const onPointerLeave = () => { const s = st.current; if (s.hover) { s.hover = null; if (s.reduced) drawOnce(); } };
  const onClick = (e: React.MouseEvent) => { const id = hitAt(e); if (id) props.current.onSelectGeneral?.(id); };

  return (
    <div ref={wrapRef} className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#020805', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Fleet floor: SAM at the top, the five Generals beneath, their running jobs as worker figures"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
