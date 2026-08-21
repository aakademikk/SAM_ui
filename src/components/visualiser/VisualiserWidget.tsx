'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useVisualiserState } from '@/hooks/useVisualiserState';
import type { VisualiserState, VisualiserSnapshot } from '@/hooks/useVisualiserState';
import { getMicWaveform, getAudioSpeaking } from '@/lib/client/micAnalyser';

/* ========================================================================== */
/* Constants                                                                  */
/* ========================================================================== */

type Rgb = [number, number, number];

const COLS: Record<VisualiserState, Rgb> = {
  idle: [0, 210, 255],
  listening: [50, 220, 255],
  thinking: [255, 180, 20],
  speaking: [255, 255, 255],
  alert: [255, 28, 15],
};

const STATE_DOT_COLORS: Record<VisualiserState, string> = {
  idle: '#55ccdd',
  listening: '#66ddff',
  thinking: '#ffbb33',
  speaking: '#ffffff',
  alert: '#ff3311',
};

const AMBER: Rgb = [255, 170, 0];

function stateCol(state: VisualiserState): Rgb {
  return COLS[state] ?? COLS.idle;
}

/* ---- Boot assembly helpers ------------------------------------------------ */

/** Normalise `v` into 0..1 across the window [from, to], clamped at both ends. */
function stage(v: number, from: number, to: number): number {
  if (v <= from) return 0;
  if (v >= to) return 1;
  return (v - from) / (to - from);
}

/** Decelerating ease — fast departure, soft landing. Used for node convergence. */
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function getTargets(s: VisualiserState): [number, number, number] {
  switch (s) {
    case 'idle':      return [0.5, 0.5, 0.08];
    case 'listening': return [0.75, 0.8, 0.4];
    case 'thinking':  return [0.9, 0.85, 0.95];
    case 'speaking':  return [1.0, 1.0, 0.9];
    case 'alert':     return [1.0, 1.0, 0.0];
    default:          return [0.5, 0.5, 0.08];
  }
}

/* ========================================================================== */
/* Types for animation state (mutable refs, not React state)                  */
/* ========================================================================== */

interface MeshNode {
  x: number; y: number; z: number;
  b: number;  // base brightness
  po: number; // phase offset
  // Boot assembly: where this node flies in from, and how late it starts.
  sx: number; sy: number; sz: number;
  dly: number; // 0..1 stagger, so the mesh lands as a wave rather than at once
}

interface MeshEdge {
  a: number;
  b: number;
  ba: number; // brightness attenuation
}

interface Particle {
  alive: boolean;
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  ang: number;
}

interface AnimState {
  energy: number;
  glow: number;
  motion: number;
  breathePhase: number;
  totalTime: number;
  lastTime: number;
  pBudget: number;
  particles: Particle[];
  meshNodes: MeshNode[];
  meshEdges: MeshEdge[];
}

/* ========================================================================== */
/* Mesh construction (pure functions — not dependent on React)                */
/* ========================================================================== */

function buildMeshNodes(count: number, S: number): MeshNode[] {
  const phi = Math.PI * (3 - Math.sqrt(5));
  const R = S * 0.35;
  const nodes: MeshNode[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const rAtY = Math.sqrt(1 - y * y);
    const theta = phi * i;
    let nx = Math.cos(theta) * rAtY;
    let ny = y;
    let nz = Math.sin(theta) * rAtY;

    // Brain-like lobe distortion
    const az = Math.atan2(nz, nx);
    const el = Math.asin(ny);
    const fold =
      Math.sin(az * 3.5) * Math.cos(el * 5) * 0.12 +
      Math.sin(az * 1.7 + el * 2.3) * 0.08 +
      Math.cos(el * 7) * 0.06;
    const r = R * (1 + fold);
    nx *= r; ny *= r; nz *= r;

    // Boot origin: flung out along its own bearing, well outside the sphere, so
    // the assembly reads as the mesh pulling itself inward rather than a fade.
    const sd = 2.4 + Math.random() * 2.2;

    nodes.push({
      x: nx, y: ny, z: nz,
      b: 0.4 + Math.random() * 0.6,
      po: Math.random() * Math.PI * 2,
      sx: nx * sd, sy: ny * sd, sz: nz * sd,
      // Stagger by height so the sphere assembles as a sweep, with a little
      // jitter to stop it looking like a mechanical wipe.
      dly: Math.min(1, Math.max(0, (1 - (y + 1) / 2) * 0.8 + Math.random() * 0.2)),
    });
  }
  return nodes;
}

function buildMeshEdges(nodes: MeshNode[], S: number): MeshEdge[] {
  const maxDist = S * 0.14;
  const edges: MeshEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const near: { idx: number; dist: number }[] = [];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
      if (d < maxDist) near.push({ idx: j, dist: d });
    }
    near.sort((x, y) => x.dist - y.dist);
    const keep = Math.min(4, near.length);
    for (let k = 0; k < keep; k++) {
      edges.push({ a: i, b: near[k].idx, ba: 1 - near[k].dist / maxDist });
    }
  }
  return edges;
}

function createParticles(count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    alive: false, x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1.5, size: 0.8, ang: 0,
  }));
}

/* ========================================================================== */
/* Component                                                                  */
/* ========================================================================== */

export interface VisualiserWidgetProps {
  /** URL to poll for state. Pass `null` when `state` drives it locally. */
  stateUrl?: string | null;
  /**
   * Fixed pixel size for a compact, embedded rendering (square box).
   * When omitted, the visualiser fills the viewport as a fixed background
   * (the original dashboard behaviour) and shows the state HUD badge.
   */
  size?: number;
  /** Drive the state directly instead of polling. Disables the poll. */
  state?: VisualiserState;
  /** Show the corner state badge. Defaults to on for the full-screen form. */
  hud?: boolean;
  /**
   * Boot assembly progress, 0 → 1. At 0 the canvas is empty; at 1 the
   * visualiser is fully formed and this has no effect at all. Omit for the
   * normal, already-built rendering.
   */
  boot?: number;
}

export function VisualiserWidget({
  stateUrl = 'http://127.0.0.1:8778/state',
  size,
  state: override,
  hud,
  boot = 1,
}: VisualiserWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimState | null>(null);
  const dimsRef = useRef({ cx: 0, cy: 0, S: 0, dpr: 1 });
  const compact = size !== undefined;
  const showHud = hud ?? true;

  const polled = useVisualiserState(override !== undefined ? null : stateUrl);
  const snapshot: VisualiserSnapshot =
    override !== undefined
      ? {
          state: override,
          waveform: polled.waveform,
          timestamp: Date.now() / 1000,
          mode: 'real',
          loading: override === 'thinking',
        }
      : polled;
  // Keep a stable ref to the latest snapshot so the animation loop never
  // restarts — it reads the latest state from the ref each frame.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Same reason as the snapshot ref: boot progress changes every frame while
  // the intro plays, and re-running the effect would restart the animation.
  const bootRef = useRef(boot);
  bootRef.current = boot;

  /* ---- Resize handler ---------------------------------------------------- */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = compact ? (size as number) : window.innerWidth;
    const h = compact ? (size as number) : window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    dimsRef.current = {
      cx: w / 2,
      cy: h / 2,
      S: Math.min(w / 2, h / 2),
      dpr,
    };
    // Rebuild mesh when size changes
    if (animRef.current) {
      const S = dimsRef.current.S;
      animRef.current.meshNodes = buildMeshNodes(500, S);
      animRef.current.meshEdges = buildMeshEdges(animRef.current.meshNodes, S);
    }
  }, [compact, size]);

  /* ---- Initialise animation state ---------------------------------------- */
  useEffect(() => {
    const S = dimsRef.current.S || Math.min(window.innerWidth / 2, window.innerHeight / 2);
    const nodes = buildMeshNodes(500, S);
    animRef.current = {
      energy: 0.4,
      glow: 0.4,
      motion: 0.05,
      breathePhase: 0,
      totalTime: 0,
      lastTime: performance.now(),
      pBudget: 0,
      particles: createParticles(400),
      meshNodes: nodes,
      meshEdges: buildMeshEdges(nodes, S),
    };

    resize();
    window.addEventListener('resize', resize);

    /* ---- Animation loop -------------------------------------------------- */
    let rafId: number;
    function frame(ts: number) {
      rafId = requestAnimationFrame(frame);
      const canvas = canvasRef.current;
      const anim = animRef.current;
      const dims = dimsRef.current;
      if (!canvas || !anim || dims.S === 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dt = Math.min(0.1, (ts - anim.lastTime) / 1000);
      anim.lastTime = ts;
      anim.totalTime = ts / 1000;

      // Boot assembly progress. 1 means "fully built", which is the normal
      // case — every factor derived from it collapses to 1 and costs nothing.
      // (Named `bootP`, not `bp` — the edge loop below already binds `bp` to a
      // projected point, and shadowing that would be a nasty trap to leave.)
      const bootP = bootRef.current;

      // ---- Energy ---------------------------------------------------------
      const serverState = snapshotRef.current.state;
      // Priority: audio playing → speaking, mic active → listening, else server
      const micData = getMicWaveform();
      const micActive = micData && (Date.now() - micData.timestamp) < 300;
      const audioActive = getAudioSpeaking();
      const appState: VisualiserState = audioActive
        ? 'speaking'
        : micActive
          ? 'listening'
          : serverState;
      const tgt = getTargets(appState);
      if (appState === 'idle') {
        anim.breathePhase += dt;
        anim.energy +=
          (tgt[0] + Math.sin(anim.breathePhase * 1.8) * 0.18 - anim.energy) *
          Math.min(1, dt * 3);
      } else {
        anim.breathePhase = 0;
        anim.energy += (tgt[0] - anim.energy) * Math.min(1, dt * (appState === 'alert' ? 14 : 3.5));
      }
      anim.glow += (tgt[1] - anim.glow) * Math.min(1, dt * 3.5);
      anim.motion += (tgt[2] - anim.motion) * Math.min(1, dt * 3.5);

      // ---- Particles -------------------------------------------------------
      // Emission is the last thing to come up: the core has to be lit before
      // it can throw anything off.
      const rate = (5 + anim.glow * 150) * stage(bootP, 0.68, 1);
      anim.pBudget += rate * dt;
      const particles = anim.particles;
      while (anim.pBudget >= 1) {
        // spawn one particle
        const a = Math.random() * Math.PI * 2;
        const d = dims.S * (0.05 + Math.random() * 0.3);
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          if (!p.alive) {
            p.x = dims.cx + Math.cos(a) * d;
            p.y = dims.cy + Math.sin(a) * d;
            p.vx = Math.cos(a) * (30 + Math.random() * 120);
            p.vy = Math.sin(a) * (30 + Math.random() * 120);
            p.life = 0;
            p.maxLife = 0.8 + Math.random() * 2.5;
            p.size = 0.5 + Math.random() * 2.2;
            p.alive = true;
            p.ang = a;
            break;
          }
        }
        anim.pBudget -= 1;
      }
      if (anim.pBudget > 3) anim.pBudget = 3;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p.alive) continue;
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (
          p.life >= p.maxLife ||
          Math.sqrt((p.x - dims.cx) ** 2 + (p.y - dims.cy) ** 2) > dims.S * 1.1
        ) {
          p.alive = false;
        }
      }

      // ---- Render ----------------------------------------------------------
      const { cx, cy, S, dpr } = dims;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      const w = compact ? (size as number) : window.innerWidth;
      const h = compact ? (size as number) : window.innerHeight;
      const t = anim.totalTime;
      const col = stateCol(appState);
      const { glow, motion } = anim;

      /* ---- Boot staging ----------------------------------------------------
       * The order is the story: substrate first, then the mesh pulls itself in,
       * the core ignites, and only then does the holographic furniture arrive.
       * Every window collapses to 1 once bp hits 1.
       */
      const bGrid    = stage(bootP, 0.00, 0.22); // grid + vias — the substrate
      const bTrace   = stage(bootP, 0.10, 0.40); // etched trace highways
      const bEdge    = stage(bootP, 0.42, 0.72); // mesh edges stitching together
      const bCore    = stage(bootP, 0.30, 0.80); // core glow igniting
      const bSocket  = stage(bootP, 0.48, 0.72); // socket rings
      const bPulse   = stage(bootP, 0.55, 0.85); // energy running the traces
      const bRing    = stage(bootP, 0.62, 0.92); // holo rings
      const bCorner  = stage(bootP, 0.80, 1.00); // corner brackets — HUD last
      const bParticle = stage(bootP, 0.68, 1.00);

      // Clear
      ctx.fillStyle = '#010812';
      ctx.fillRect(0, 0, w, h);

      // ---- Grid ------------------------------------------------------------
      ctx.strokeStyle = 'rgba(10,40,70,' + 0.35 * bGrid + ')';
      ctx.lineWidth = 0.4;
      const gs = 30;
      if (bGrid > 0.01) {
        for (let x = gs; x < w; x += gs) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = gs; y < h; y += gs) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
      }

      // ---- Vias ------------------------------------------------------------
      if (bGrid > 0.01) {
        for (let vx = -S * 0.55; vx < S * 0.55; vx += 50) {
          for (let vy = -S * 0.55; vy < S * 0.55; vy += 50) {
            const d = Math.sqrt(vx * vx + vy * vy);
            if (d < S * 0.2 || d > S * 0.55) continue;
            ctx.beginPath();
            ctx.arc(cx + vx, cy + vy, 1.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(25,80,140,' + 0.4 * bGrid + ')';
            ctx.fill();
          }
        }
      }

      // ---- Trace highways --------------------------------------------------
      // Traces etch outward from the core rather than fading in as a block.
      const traceReach = bTrace;
      for (let b = 0; b < 24 && bTrace > 0.01; b++) {
        const angle = (b / 24) * Math.PI * 2;
        const innerR = S * 0.26;
        const midR = S * (0.5 + Math.sin(b * 2.1) * 0.08);
        const outerR = S * (0.94 + Math.cos(b * 1.3) * 0.05);

        const lines = 4 + Math.floor(Math.abs(Math.sin(b * 3.7)) * 5);
        for (let l = 0; l < lines; l++) {
          const offset = (l - (lines - 1) / 2) * 4;

          const mx = cx + Math.cos(angle) * midR + Math.cos(angle + Math.PI / 2) * offset;
          const my = cy + Math.sin(angle) * midR + Math.sin(angle + Math.PI / 2) * offset;
          const ex = cx + Math.cos(angle) * outerR + Math.cos(angle + Math.PI / 2) * offset;
          const ey = cy + Math.sin(angle) * outerR + Math.sin(angle + Math.PI / 2) * offset;
          const sx = cx + Math.cos(angle) * innerR + Math.cos(angle + Math.PI / 2) * offset;
          const sy = cy + Math.sin(angle) * innerR + Math.sin(angle + Math.PI / 2) * offset;

          const bx = mx + Math.cos(angle + (b % 2 === 0 ? 0.6 : -0.6)) * S * 0.06;
          const by = my + Math.sin(angle + (b % 2 === 0 ? 0.6 : -0.6)) * S * 0.06;

          // Etch outward: below half reach the trace stops short of the bend,
          // above it the bend is fixed and the outer leg extends.
          const preBend = traceReach < 0.5;
          const k = preBend ? traceReach / 0.5 : (traceReach - 0.5) / 0.5;
          const tipX = preBend ? sx + (bx - sx) * k : bx + (ex - bx) * k;
          const tipY = preBend ? sy + (by - sy) * k : by + (ey - by) * k;

          const strokeTrace = () => {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            if (!preBend) ctx.lineTo(bx, by);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
          };

          // Main trace
          ctx.strokeStyle = 'rgba(20,70,130,0.55)';
          ctx.lineWidth = 0.7;
          strokeTrace();

          // Inner bright core
          ctx.strokeStyle = 'rgba(40,120,200,' + (0.15 + glow * 0.15) + ')';
          ctx.lineWidth = 0.25;
          strokeTrace();
        }

        // Energy pulse wavefronts — colour follows active state
        const dcol = col;
        const pulseCount = 3;
        for (let pc = 0; pc < pulseCount; pc++) {
          const pOffset = pc / pulseCount;
          const dp = ((t * 0.22 + b * 0.15 + pOffset) % 1 + 1) % 1;
          const fadeAlpha = dp < 0.15 ? dp / 0.15 : dp > 0.85 ? (1 - dp) / 0.15 : 1;
          const dx = cx + Math.cos(angle) * (innerR + (outerR - innerR) * dp);
          const dy = cy + Math.sin(angle) * (innerR + (outerR - innerR) * dp);
          const baseAlpha = glow * 0.95 * fadeAlpha * bPulse;
          if (baseAlpha < 0.04) continue;

          ctx.beginPath();
          ctx.arc(dx, dy, 3, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' +
            Math.min(255, dcol[0] + 120) + ',' +
            Math.min(255, dcol[1] + 120) + ',' +
            Math.min(255, dcol[2] + 120) + ',' + baseAlpha + ')';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(dx, dy, 10, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' + dcol[0] + ',' + dcol[1] + ',' + dcol[2] + ',' + (baseAlpha * 0.35) + ')';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(dx, dy, 20, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' + dcol[0] + ',' + dcol[1] + ',' + dcol[2] + ',' + (baseAlpha * 0.1) + ')';
          ctx.fill();
        }

        // Wavefront ring
        const wfRing = (t * 0.12 + b * 0.08) % 1.3;
        if (wfRing < 1) {
          const wd = cx + Math.cos(angle) * (innerR + (outerR - innerR) * wfRing);
          const wy = cy + Math.sin(angle) * (innerR + (outerR - innerR) * wfRing);
          const wfAlpha = glow * 0.5 * (1 - wfRing) * bPulse;
          ctx.beginPath();
          ctx.arc(wd, wy, 14, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' + dcol[0] + ',' + dcol[1] + ',' + dcol[2] + ',' + wfAlpha + ')';
          ctx.fill();
        }
      }

      // ---- Socket rings ----------------------------------------------------
      for (let ring = 0; ring < 3; ring++) {
        const rr = S * (0.22 + ring * 0.04);
        const count = 48 + ring * 10;
        // Pins seat around the ring as boot advances rather than fading in.
        const seated = Math.round(count * bSocket);
        for (let i = 0; i < seated; i++) {
          const a = (i / count) * Math.PI * 2;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(a + Math.PI / 2);
          ctx.fillStyle = 'rgba(30,90,150,0.55)';
          ctx.fillRect(-1.5, -0.7, 3, 1.4);
          ctx.restore();
        }
      }

      // ---- Core glow -------------------------------------------------------
      // Ignition overshoots briefly as it catches, so the core strikes like an
      // arc rather than swelling politely. Collapses to plain `glow` at bp = 1.
      const ignite = bCore * (1 + 0.9 * Math.sin(Math.PI * stage(bootP, 0.46, 0.62)));
      const inten = glow * ignite;
      const outerR = S * 0.55 * Math.min(1, inten);

      const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
      g1.addColorStop(0, 'rgba(255,255,255,' + inten + ')');
      g1.addColorStop(0.03, 'rgba(' + Math.min(255, col[0] + 100) + ',' + Math.min(255, col[1] + 100) + ',' + Math.min(255, col[2] + 100) + ',' + inten * 0.95 + ')');
      g1.addColorStop(0.12, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + inten * 0.7 + ')');
      g1.addColorStop(0.35, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + inten * 0.3 + ')');
      g1.addColorStop(0.7, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + inten * 0.08 + ')');
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(cx - outerR, cy - outerR, outerR * 2, outerR * 2);

      // Hot center dot
      const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.04 * inten);
      hg.addColorStop(0, 'rgba(255,255,255,' + inten + ')');
      hg.addColorStop(0.5, 'rgba(255,255,255,' + inten * 0.7 + ')');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(cx - S * 0.04, cy - S * 0.04, S * 0.08, S * 0.08);

      // ---- Neural mesh -----------------------------------------------------
      const rot = t * motion * 0.5;
      const tilt = t * motion * 0.25;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

      const nodes = anim.meshNodes;
      const proj: { x: number; y: number; d: number; b: number; po: number; a: number }[] = [];
      const building = bootP < 1;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        // Per-node arrival, staggered by `dly` and eased so each one decelerates
        // into its slot. At rest this is a flat 1 and the lerps are skipped.
        const arrive = building
          ? easeOutCubic(stage(bootP, n.dly * 0.42, n.dly * 0.42 + 0.34))
          : 1;
        const ox = building ? n.sx + (n.x - n.sx) * arrive : n.x;
        const oy = building ? n.sy + (n.y - n.sy) * arrive : n.y;
        const oz = building ? n.sz + (n.z - n.sz) * arrive : n.z;

        const rx = ox * cosR - oz * sinR;
        let rz = ox * sinR + oz * cosR;
        const ry = oy * cosT - rz * sinT;
        rz = oy * sinT + rz * cosT;
        const depth = Math.max(0, Math.min(1, (rz / (S * 0.32) + 1) / 2));
        proj.push({ x: cx + rx, y: cy + ry, d: depth, b: n.b, po: n.po, a: arrive });
      }

      // Node pulse
      let pulse: number;
      // Live mic waveform takes priority over server-polled TTS waveform
      if (micActive && micData) {
        let s = 0;
        for (let i = 0; i < micData.waveform.length; i++) s += micData.waveform[i] ** 2;
        pulse = 0.4 + Math.min(0.6, Math.sqrt(s / micData.waveform.length) * 4);
      } else if (appState === 'speaking') {
        let s = 0;
        for (let i = 0; i < snapshotRef.current.waveform.length; i++) s += snapshotRef.current.waveform[i] ** 2;
        pulse = 0.4 + Math.min(0.6, Math.sqrt(s / snapshotRef.current.waveform.length) * 4);
      } else if (appState === 'thinking') {
        pulse = 0.3 + 0.5 * Math.abs(Math.sin(t * 4));
      } else if (appState === 'idle') {
        pulse = 0.18 + 0.35 * Math.sin(t * 1.8) + 0.15 * Math.sin(t * 3.3 + 1.2);
      } else {
        pulse = 0.2 + 0.25 * Math.sin(t * 2.5);
      }

      // Edges
      const eAlpha = glow * 0.5 * bEdge;
      for (let ei = 0; ei < anim.meshEdges.length; ei++) {
        const e = anim.meshEdges[ei];
        const ap = proj[e.a], bp = proj[e.b];
        const da = Math.min(ap.d, bp.d);
        // An edge cannot exist before both of its nodes have landed.
        const alpha = eAlpha * e.ba * da * (0.3 + 0.85 * pulse) * Math.min(ap.a, bp.a);
        if (alpha < 0.02) continue;

        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(bp.x, bp.y);
        ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha + ')';
        ctx.lineWidth = 0.7;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(bp.x, bp.y);
        ctx.strokeStyle =
          'rgba(' +
          Math.min(255, col[0] + 80) + ',' +
          Math.min(255, col[1] + 80) + ',' +
          Math.min(255, col[2] + 80) + ',' + alpha * 0.6 + ')';
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }

      // Nodes
      for (let pi = 0; pi < proj.length; pi++) {
        const p = proj[pi];
        const ba = 0.25 + glow * 0.6;
        const pa = pulse * 0.9 * Math.abs(Math.sin(t * 5 + p.po));
        // Nodes flare as they come in and settle to normal once seated.
        const flare = p.a < 1 ? p.a * (1 + 0.6 * Math.sin(Math.PI * p.a)) : 1;
        const alpha = Math.max(0, Math.min(1, (ba + pa) * p.d * flare));
        if (alpha < 0.04) continue;

        const sz = 1.5 + p.d * 2.2;

        ctx.beginPath();
        ctx.arc(p.x, p.y, sz * 5, 0, Math.PI * 2);
        ctx.fillStyle =
          'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha * 0.2 + ')';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
        ctx.fillStyle =
          'rgba(' +
          Math.min(255, col[0] + 120) + ',' +
          Math.min(255, col[1] + 120) + ',' +
          Math.min(255, col[2] + 120) + ',' + alpha + ')';
        ctx.fill();
      }

      // Amber hotspot nodes (thinking)
      if (motion > 0.3) {
        const aa = glow * (motion - 0.3) * 0.8;
        const ac = Math.floor(10 + motion * 25);
        for (let ai = 0; ai < ac; ai++) {
          const idx = Math.floor((Math.sin(ai * 7.3 + t * 1.3) * 0.5 + 0.5) * nodes.length);
          const ap = proj[idx % proj.length];
          const a = aa * (0.5 + 0.5 * Math.sin(t * 4 + ai * 2.5));
          if (a < 0.04 || ap.d < 0.3) continue;
          ctx.beginPath();
          ctx.arc(ap.x, ap.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,170,0,' + a * 0.4 + ')';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(ap.x, ap.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,200,50,' + a + ')';
          ctx.fill();
        }
      }

      // ---- Holo rings -------------------------------------------------------
      // Rings expand outward into position as they come up, rather than just
      // appearing at their final radius.
      const rScale = 0.82 + 0.18 * bRing;
      const rings = [
        { r: S * 0.38 * rScale, a: glow * 0.5 * bRing, seg: 22, gap: 0.26, rot: t * 0.35 * (1 + motion), lw: 1.1 },
        { r: S * 0.48 * rScale, a: glow * 0.38 * bRing, seg: 26, gap: 0.3, rot: -t * 0.25 * (1 + motion * 1.5), lw: 0.85 },
        { r: S * 0.58 * rScale, a: glow * 0.26 * bRing, seg: 32, gap: 0.34, rot: t * 0.18 * (1 + motion * 0.8), lw: 0.65 },
      ];
      for (let ri = 0; ri < rings.length; ri++) {
        const r = rings[ri];
        if (r.a < 0.02) continue;
        const segA = (Math.PI * 2) / r.seg;
        const solidA = segA * (1 - r.gap);
        for (let s = 0; s < r.seg; s++) {
          const sa = r.rot + s * segA;
          const ea = sa + solidA;
          ctx.beginPath();
          ctx.arc(cx, cy, r.r, sa, ea);
          ctx.strokeStyle =
            'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + r.a + ')';
          ctx.lineWidth = r.lw;
          ctx.stroke();
        }
        // Tick dots
        for (let ti = 0; ti < r.seg; ti++) {
          const ta = r.rot + ti * segA + solidA / 2;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ta) * r.r, cy + Math.sin(ta) * r.r, r.lw * 1.2, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' +
            Math.min(255, col[0] + 100) + ',' +
            Math.min(255, col[1] + 100) + ',' +
            Math.min(255, col[2] + 100) + ',' + r.a * 1.5 + ')';
          ctx.fill();
        }
      }

      // ---- Corner brackets --------------------------------------------------
      const cornerAlpha = (0.2 + glow * 0.6) * bCorner;
      if (cornerAlpha >= 0.04) {
        const d = S * 0.84;
        const sz = S * 0.055;
        const corners: [number, number, number, number][] = [
          [cx - d, cy - d, 1, 1],
          [cx + d, cy - d, -1, 1],
          [cx + d, cy + d, -1, -1],
          [cx - d, cy + d, 1, -1],
        ];
        for (let ci = 0; ci < corners.length; ci++) {
          const c = corners[ci];
          const len = sz * (1 + glow * 0.35);
          ctx.shadowColor =
            'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + cornerAlpha + ')';
          ctx.shadowBlur = 8;
          ctx.strokeStyle =
            'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + cornerAlpha + ')';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(c[0], c[1]);
          ctx.lineTo(c[0] - c[2] * len, c[1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(c[0], c[1]);
          ctx.lineTo(c[0], c[1] - c[3] * len);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(c[0], c[1], 2.5, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' +
            Math.min(255, col[0] + 120) + ',' +
            Math.min(255, col[1] + 120) + ',' +
            Math.min(255, col[2] + 120) + ',' + cornerAlpha * 1.3 + ')';
          ctx.fill();
        }
      }

      // ---- Particles --------------------------------------------------------
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p.alive) continue;
        const lt = p.life / p.maxLife;
        let a = lt < 0.12 ? lt / 0.12 : lt > 0.6 ? (1 - lt) / 0.4 : 1;
        a *= glow * bParticle;
        if (a < 0.03) continue;
        const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
        const df = Math.max(0, 1 - d / (S * 0.9));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle =
          'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a * df + ')';
        ctx.fill();

        if (a * df > 0.18) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
          ctx.fillStyle =
            'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + a * df * 0.2 + ')';
          ctx.fill();
        }
      }

      // ---- Alert rings ------------------------------------------------------
      if (appState === 'alert') {
        const alertPulse = 0.5 + 0.5 * Math.sin(t * 10);
        for (let ring = 0; ring < 3; ring++) {
          const rr = S * (0.48 + ring * 0.15);
          const ra = glow * (0.25 + alertPulse * 0.4) * (1 - ring * 0.3);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,28,15,' + ra + ')';
          ctx.lineWidth = 2.2 - ring * 0.6;
          ctx.stroke();
        }
      }

      // ---- Vignette ---------------------------------------------------------
      const vg = ctx.createRadialGradient(cx, cy, S * 0.35, cx, cy, S * 1.15);
      vg.addColorStop(0, 'rgba(1,8,18,0)');
      vg.addColorStop(1, 'rgba(1,5,12,0.88)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    // Kick off the animation loop
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize]);

  /* ---- Render ------------------------------------------------------------ */
  if (compact) {
    return (
      <div
        ref={containerRef}
        className="pointer-events-none relative"
        style={{ width: size, height: size }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {/* HUD overlay — matches the original index.html HUD */}
      <div
        className="absolute inset-x-0 top-0 z-5 flex items-start justify-between px-8 py-7"
        style={{ opacity: 1, display: showHud ? undefined : 'none' }}
      >
        <div
          className="flex items-center gap-2 rounded-sm border px-3 py-1.5"
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(160,220,255,0.6)',
            background: 'rgba(1,10,20,0.7)',
            borderColor: 'rgba(60,140,200,0.2)',
          }}
        >
          <span
            className="inline-block h-[5px] w-[5px] rounded-full"
            style={{
              backgroundColor: STATE_DOT_COLORS[snapshot.state] ?? '#55ccdd',
            }}
          />
          <span>{snapshot.state.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}
