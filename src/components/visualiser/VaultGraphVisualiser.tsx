'use client';

/**
 * SAM — Vault graph visualiser.
 *
 * The intro screen renders SAM's actual memory: every note in the vault as a
 * node, every resolved [[wikilink]] as an edge, laid out by how connected each
 * note is. Well-linked notes pack into a bright nucleus at the centre; isolated
 * ones drift at the rim. Energy runs outward from the core along the edges.
 *
 * The layout is *not* solved here — scripts/build_vault_graph.py precomputes it
 * daily and this reads the result, so the boot screen never pays for a force
 * solve on a phone. See src/types/vaultGraph.ts for the contract.
 *
 * Shader structure mirrors ParallaxBackground's NeuralMesh (Points + a
 * LineSegments packet-travel shader, additive, depth-write off) — including its
 * disposal, WebGLBoundary and AdaptiveDpr discipline. The differences: real
 * positions instead of a proximity graph, a flow direction that answers to
 * SAM's state, and a boot parameter that assembles the graph from nothing.
 *
 * ## Flow
 *
 * Energy does not simply radiate. Three packet streams run at once — outward,
 * inward, and circulating round the rim — and the state crossfades between
 * them, so the direction of travel *is* the status readout: SAM draws energy
 * in while listening, circulates it while thinking, and pushes it out while
 * replying. See EDGE_FRAG for why they are blended rather than switched.
 */

import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';

import snapshotJson from '@/data/vault-graph.json';
import type { VisualiserState } from '@/hooks/useVisualiserState';
import { useSamActivity } from '@/lib/samActivity';
import { makeRng } from '@/lib/utils';
import type { VaultGraph } from '@/types/vaultGraph';

/* ========================================================================== */
/* Palette                                                                    */
/* ========================================================================== */

/**
 * Per-state colour and tempo. The field is the Leonardo emerald — every node
 * and every edge pulse green — except speaking (silver/white) and alert (kept
 * red: the one real alarm colour). `mix` is pinned to 1.0 so the folder tints
 * never bleed through: the graph is one colour now, not the vault's folder map.
 * Note there is no `warning` state — the store calls it `alert`. `listening`
 * exists in the type but nothing currently sets it.
 */
interface StateStyle {
  core: string;
  accent: string;
  tempo: number;
  mix: number;
  /** -1 packets run inward, 0 they circulate the rim, +1 they run outward. */
  flow: number;
  /** How much of the idle wander this state gets: 1 free-roaming, 0 pinned. */
  drift: number;
  /**
   * How far the field opens out and gathers back — the nucleus reaching for
   * the edge of the screen and returning. Rides on uTempo, so a busier state
   * breathes faster as well as differently.
   */
  bloom: number;
}

const STATE_STYLE: Record<VisualiserState, StateStyle> = {
  idle:      { core: '#3dff5a', accent: '#9dff70', tempo: 1.00, mix: 1.0, flow:  0.00, drift: 1.00, bloom: 0.30 },
  // Listening was all but the same green as idle, which is half of why the
  // field never looked like it was reacting. Cyan, and the flow reverses:
  // energy runs *in* along the edges while SAM is taking something in.
  listening: { core: '#4dd9ff', accent: '#a8ecff', tempo: 1.30, mix: 1.0, flow: -1.00, drift: 0.40, bloom: 0.16 },
  thinking:  { core: '#6bff5a', accent: '#b8ff70', tempo: 2.10, mix: 1.0, flow:  0.00, drift: 0.14, bloom: 0.10 },
  // Tool use — SAM reaching out of the vault. Amber matches the warm family
  // the status line and the other widgets already use for a busy SAM.
  working:   { core: '#ffb43d', accent: '#ffe3a8', tempo: 2.40, mix: 1.0, flow:  0.30, drift: 0.18, bloom: 0.12 },
  speaking:  { core: '#d3dfe8', accent: '#ffffff', tempo: 1.75, mix: 1.0, flow:  1.00, drift: 0.22, bloom: 0.36 },
  alert:     { core: '#f43f5e', accent: '#fb7185', tempo: 2.70, mix: 1.0, flow:  0.00, drift: 0.00, bloom: 0.06 },
};

/**
 * The hub node (most-connected note, dead centre) renders this many times
 * larger than the next-largest note — the "eye" of the graph.
 */
const HUB_SIZE = 2.0;

/**
 * Node tint by top-level folder. Kept for the geometry — with uMix at 1.0 the
 * state colour fully overrides these, so the field is monochrome now. Drop mix
 * back down if the folder map should ever return.
 */
const FOLDER_COLOR: Record<string, string> = {
  '00 - Inbox': '#94a3b8',
  '01 - Daily Notes': '#34d399',
  '02 - Atwood Systems': '#38bdf8',
  '03 - Personal': '#c084fc',
  '04 - Archive': '#64748b',
  '05 - Resources': '#f59e0b',
  '06 - Handoffs': '#f472b6',
  '(root)': '#e2e8f0',
};
const FOLDER_FALLBACK = '#8fa3bd';

/* ========================================================================== */
/* Data                                                                       */
/* ========================================================================== */

// Imported JSON widens tuples to number[] and `ring` to number; the file is
// written by the same script that writes the live copy, so the shape holds.
const SNAPSHOT = snapshotJson as unknown as VaultGraph;

/**
 * Starts from the committed snapshot so the intro draws on the very first
 * frame, then swaps in the live graph if the API answers. The boot timeline
 * never waits on the network — same rule the readout follows.
 */
function useVaultGraph(): VaultGraph {
  const [graph, setGraph] = useState<VaultGraph>(SNAPSHOT);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/vault/graph', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: VaultGraph } | null) => {
        const next = body?.data;
        if (next?.nodes?.length) setGraph(next);
      })
      .catch(() => {
        // Offline, route missing, aborted — the snapshot is already on screen.
      });

    return () => controller.abort();
  }, []);

  return graph;
}

/* ========================================================================== */
/* Shaders                                                                    */
/* ========================================================================== */

/**
 * Radial bloom, shared verbatim by the node and edge shaders.
 *
 * Both geometries must apply the *same* displacement to the *same* input, and
 * that is the whole reason this is one string included twice rather than two
 * copies. The edges are a separate static geometry from the notes, so any
 * displacement the two disagree on by even a little tears every link off the
 * note it connects — which is exactly why the deep breath is done on the group
 * scale instead.
 */
const BLOOM_GLSL = /* glsl */ `
  uniform float uBloom;       // how far the field opens out
  uniform float uBloomPhase;  // integrated on the CPU so tempo can change

  vec3 bloomed(vec3 p) {
    float r = length(p.xy);
    if (r < 0.0001) return p;

    // Held to 0..uBloom rather than swinging either side of zero: a negative
    // amount drives small radii through zero and flips those notes out the
    // far side of the graph.
    float a = uBloom * (0.5 + 0.5 * sin(uBloomPhase));

    // An exponent below 1 moves the inner notes much further than the rim, so
    // the nucleus opens like an iris and reaches for the edge of the frame.
    // Scaling every radius equally is what the group breath already does, and
    // it reads as a zoom rather than as the field expanding.
    float r2 = mix(r, pow(r, 0.6), a);
    return vec3(p.xy * (r2 / r), p.z);
  }
`;

const NODE_VERT = /* glsl */ `
  ${BLOOM_GLSL}
  uniform float uTime;
  uniform float uBoot;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uTempo;
  uniform float uSweep;      // 0..1 angle of the rotating highlight

  attribute float aSeed;
  attribute float aWeight;   // 0..1 by degree — drives size and brightness
  attribute float aRadius;   // 0..1 distance from the nucleus
  attribute float aHub;      // 1 for the most-connected note at dead centre
  attribute vec3  aColor;

  varying float vPulse;
  varying float vWeight;
  varying float vReveal;
  varying float vHub;
  varying float vSweep;
  varying float vTwinkle;
  varying vec3  vColor;

  void main() {
    // Assembly: the nucleus resolves first and the graph grows outward, so the
    // boot reads as SAM's memory building itself rather than a fade-in.
    //
    // Phrased directly in boot progress: a note at radius r starts resolving at
    // r * SWEEP of the way through and takes DWELL to finish, so the outermost
    // ring lands just before the boot ends. Scaling uBoot by a constant instead
    // (the first attempt) ran the sweep out in the first half-second and left
    // five seconds of static graph.
    float startAt = aRadius * 0.72;
    float reveal = smoothstep(startAt, startAt + 0.26, uBoot);
    vReveal = reveal;

    float phase = aSeed * 6.28318;

    // Nodes rush out from the centre into place as they resolve.
    vec3 pos = bloomed(position) * mix(0.18, 1.0, reveal);

    // Breathing: the whole field swells slowly, each node on its own phase so
    // it never marches in step. Faster and shallower as the tempo climbs.
    float breath = sin(uTime * 0.55 * uTempo + phase) * 0.012
                 + sin(uTime * 0.21 + aRadius * 4.0) * 0.020;
    pos *= 1.0 + breath;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    vPulse = 0.5 + 0.5 * sin(uTime * 1.15 * uTempo + phase * 1.7);
    vWeight = aWeight;
    vHub = aHub;
    vColor = aColor;

    // Rotating highlight — a radar hand crossing the graph. The angular
    // distance is wrapped, so it runs continuously round instead of snapping
    // at the seam where the angle rolls over.
    float theta = atan(position.y, position.x) / 6.28318 + 0.5;
    float dTheta = abs(fract(theta - uSweep + 0.5) - 0.5);
    vSweep = smoothstep(0.15, 0.0, dTheta);

    // Rim twinkle, scaled by radius: the nucleus holds steady and only the
    // outlying notes flicker, which is what sells the rim as depth rather
    // than as dust that failed to resolve.
    vTwinkle = (0.5 + 0.5 * sin(uTime * (1.6 + aSeed * 2.4) + aSeed * 37.0)) * aRadius;

    gl_Position = projectionMatrix * mvPosition;

    // The hub renders as a clear iris above the surrounding ring — bigger than
    // even the next-best-connected notes, so the graph reads as an eye.
    float size = uSize * mix(0.60, 2.30, pow(aWeight, 0.75)) * mix(1.0, ${HUB_SIZE.toFixed(2)}, aHub);
    gl_PointSize = size * uPixelRatio * (0.80 + 0.30 * vPulse) * reveal * (1.0 + vSweep * 0.30);
  }
`;

const NODE_FRAG = /* glsl */ `
  uniform vec3  uCore;
  uniform vec3  uAccent;
  uniform float uMix;
  uniform float uOpacity;

  varying float vPulse;
  varying float vWeight;
  varying float vReveal;
  varying float vHub;
  varying float vSweep;
  varying float vTwinkle;
  varying vec3  vColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    float halo = smoothstep(0.5, 0.0, d);
    float core = pow(halo, 7.0);
    float spec = pow(halo, 30.0);          // the hard white centre

    // With uMix at 1.0 the state colour owns the node outright — the whole
    // field is one colour; the folder map is no longer legible.
    vec3 stateTint = mix(uCore, uAccent, vPulse);
    vec3 color = mix(vColor, stateTint, uMix);

    // The halo skews toward the accent while the centre blows out to white,
    // which is what sells these as emissive rather than as flat dots.
    color = mix(color * 0.55 + uAccent * 0.22, color, core);
    color += vec3(spec) * (0.55 + 0.45 * vWeight);

    // The hub is the eye: an accent-coloured iris ring just inside the rim,
    // riding a brighter body so it owns the centre of the graph.
    float iris = smoothstep(0.44, 0.30, d) * (1.0 - smoothstep(0.12, 0.24, d));
    color += uAccent * vHub * (0.34 + 0.62 * iris);

    // The sweep lifts each note as it passes, so the graph reads as being lit
    // across rather than as a set of independently blinking dots.
    color += uAccent * vSweep * 0.50;

    float alpha = (halo * 0.30 + core * 0.98 + spec * 1.15)
                * uOpacity * vReveal * (0.43 + 0.62 * vWeight) * (1.0 + vHub * 0.5)
                * (1.0 + vSweep * 0.75)
                // Twinkle dims rather than brightens — the additive blend is
                // already close to clipping at the core and brightening here
                // just flattens it to white.
                * (1.0 - 0.26 * vTwinkle);

    gl_FragColor = vec4(color, alpha);
  }
`;

const EDGE_VERT = /* glsl */ `
  ${BLOOM_GLSL}

  uniform float uBoot;

  attribute float aT;        // 0 at the inner endpoint, 1 at the outer one
  attribute float aSeed;
  attribute float aOuter;    // radius of the outer endpoint, for reveal timing
  attribute float aWeight;
  attribute float aTheta;    // 0..1 angle of the edge midpoint about the hub
  attribute float aSwirl;    // +1 if inner->outer runs anticlockwise, else -1

  varying float vT;
  varying float vSeed;
  varying float vReveal;
  varying float vWeight;
  varying float vTheta;
  varying float vSwirl;

  void main() {
    // Edges resolve just behind the node they lead to.
    float startAt = aOuter * 0.72 + 0.05;
    vReveal = smoothstep(startAt, startAt + 0.24, uBoot);
    vT = aT;
    vSeed = aSeed;
    vWeight = aWeight;
    vTheta = aTheta;
    vSwirl = aSwirl;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(bloomed(position), 1.0);
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;      // monotonic travel clock, integrated on the CPU
  uniform vec3  uCore;
  uniform vec3  uAccent;
  uniform float uOpacity;
  uniform float uStaccato;
  uniform float uOut;        // weight of the outward stream
  uniform float uIn;         // weight of the inward stream
  uniform float uSwirl;      // weight of the circulating stream
  uniform float uSweep;

  varying float vT;
  varying float vSeed;
  varying float vReveal;
  varying float vWeight;
  varying float vTheta;
  varying float vSwirl;

  /* Head and wake of a packet sitting at 'travel', as seen by this fragment. */
  vec2 packetAt(float travel) {
    float d = abs(vT - travel);
    d = min(d, 1.0 - d);
    // Tight head with a longer trailing wake — a data pulse, not a glow worm.
    return vec2(smoothstep(0.085, 0.0, d), smoothstep(0.26, 0.0, d) * 0.32);
  }

  void main() {
    float k = 0.7 + vSeed * 0.7;   // per-edge speed spread

    // Three streams run at once and the state crossfades between them.
    //
    // They are blended rather than switched because a packet's position is a
    // function of the accumulated clock: flip the sign of that term and the
    // packet teleports by however far it had already travelled, so every state
    // change would snap. Crossfading three continuous streams instead makes a
    // state change read as the flow re-orienting.
    //
    // The circulating stream is the one that runs *around* the graph rather
    // than out of it: its phase comes from the edge's own angle, so a pulse
    // arrives as a wave sweeping round the rim, and aSwirl orients every edge
    // the same way about the hub, so an irregular wikilink graph still
    // circulates coherently instead of cancelling itself out.
    //
    // Note the circulating stream deliberately does NOT take the per-edge
    // speed spread k. Measured: with k applied, uPhase * k differs so much
    // between edges that fract() scatters them uniformly and the wave stops
    // existing — angular lock went to 0.98 (1.0 being "no wave at all"), which
    // is a slightly slower version of the radial scatter this was meant to
    // replace. Every edge has to share one angular clock for a current to
    // form; vSeed only jitters it enough to stop it looking machined.
    vec2 pOut   = packetAt(fract( uPhase * k + vSeed));
    vec2 pIn    = packetAt(fract(-uPhase * k + vSeed));
    vec2 pSwirl = packetAt(fract( uPhase * vSwirl + vTheta + vSeed * 0.12));

    vec2 p = pOut * uOut + pIn * uIn + pSwirl * uSwirl;
    float packet = p.x;
    float wake = p.y;

    // Under alert the pulse chops rather than glides.
    packet *= mix(1.0, step(0.5, fract(uTime * 5.5 + vSeed)), uStaccato);

    // Energy dissipates on the way out and gathers on the way in, so the
    // direction of travel is legible from the brightness gradient alone even
    // between packets. The three weights sum to 1, so this stays a blend.
    float falloff = mix(1.0, 0.38, vT) * (uOut + uSwirl) + mix(0.38, 1.0, vT) * uIn;

    vec3 trace = mix(uCore, uAccent, vT);
    // The packet brightens toward the core colour and only just clips to white
    // at its very centre — adding flat white was what made these read as wires.
    vec3 color = trace + uCore * packet * 0.55 + vec3(packet * packet * 0.30);

    // Same rotating hand the nodes answer to, so the sweep crosses the whole
    // object at once instead of lighting the nodes off their own schedule.
    float dTheta = abs(fract(vTheta - uSweep + 0.5) - 0.5);
    float sweep = smoothstep(0.15, 0.0, dTheta);
    color += uAccent * sweep * 0.28;

    float base = 0.060 + 0.05 * vWeight;
    float alpha = (base + packet * 0.62 + wake * 0.18)
                * uOpacity * vReveal * falloff * (1.0 + sweep * 0.50);

    gl_FragColor = vec4(color, alpha);
  }
`;

/* ========================================================================== */
/* Mesh                                                                       */
/* ========================================================================== */

interface MeshProps {
  graph: VaultGraph;
  state: VisualiserState;
  boot: number;
  animate: boolean;
  ambient: boolean;
}

function GraphMesh({ graph, state, boot, animate, ambient }: MeshProps) {
  const { viewport } = useThree();
  const style = STATE_STYLE[state] ?? STATE_STYLE.idle;

  const groupRef = useRef<THREE.Group>(null);
  // Mutating the uniforms object we hand to <shaderMaterial> does not reach the
  // GPU — the material does not necessarily keep that same object, so every
  // per-frame write silently landed on a detached copy and uTime/uBoot stayed
  // at their initial values. Write through the material instead.
  const nodeMatRef = useRef<THREE.ShaderMaterial>(null);
  const edgeMatRef = useRef<THREE.ShaderMaterial>(null);

  /* ---- geometry ---------------------------------------------------------- */

  const { nodeGeometry, edgeGeometry } = useMemo(() => {
    const rng = makeRng('sam-vault-graph');
    const nodes = graph.nodes;
    const count = nodes.length;

    const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));
    const radiusOf = nodes.map((n) => Math.min(1, Math.hypot(n.x, n.y)));
    const weightOf = nodes.map((n) => Math.pow(n.degree / maxDegree, 0.6));

    const hubIndex = graph.hub;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const weights = new Float32Array(count);
    const radii = new Float32Array(count);
    const hubs = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const scratch = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      positions[i * 3] = n.x;
      positions[i * 3 + 1] = -n.y; // JSON y grows downward; WebGL grows up
      // A little depth by ring so the slow yaw produces real parallax rather
      // than a flat card turning.
      positions[i * 3 + 2] = -n.ring * 0.05 + (rng() - 0.5) * 0.05;

      seeds[i] = rng();
      weights[i] = weightOf[i];
      radii[i] = radiusOf[i];
      hubs[i] = i === hubIndex ? 1 : 0;

      scratch.set(FOLDER_COLOR[n.folder] ?? FOLDER_FALLBACK);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nodeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    nodeGeo.setAttribute('aWeight', new THREE.BufferAttribute(weights, 1));
    nodeGeo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    nodeGeo.setAttribute('aHub', new THREE.BufferAttribute(hubs, 1));
    nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    /* edges — authored inner endpoint first so packets travel outward */
    const segments = graph.edges.length;
    const ePos = new Float32Array(segments * 6);
    const eT = new Float32Array(segments * 2);
    const eSeed = new Float32Array(segments * 2);
    const eOuter = new Float32Array(segments * 2);
    const eWeight = new Float32Array(segments * 2);
    const eTheta = new Float32Array(segments * 2);
    const eSwirl = new Float32Array(segments * 2);

    for (let e = 0; e < segments; e++) {
      const [rawA, rawB] = graph.edges[e];
      const swap = radiusOf[rawA] > radiusOf[rawB];
      const a = swap ? rawB : rawA;
      const b = swap ? rawA : rawB;

      for (let k = 0; k < 3; k++) {
        ePos[e * 6 + k] = positions[a * 3 + k];
        ePos[e * 6 + 3 + k] = positions[b * 3 + k];
      }

      const seed = rng();
      eT[e * 2] = 0;
      eT[e * 2 + 1] = 1;
      eSeed[e * 2] = seed;
      eSeed[e * 2 + 1] = seed;
      eOuter[e * 2] = radiusOf[b];
      eOuter[e * 2 + 1] = radiusOf[b];
      const w = Math.max(weightOf[a], weightOf[b]);
      eWeight[e * 2] = w;
      eWeight[e * 2 + 1] = w;

      // Where this edge sits around the hub, and which way round it points.
      const ax = positions[a * 3];
      const ay = positions[a * 3 + 1];
      const bx = positions[b * 3];
      const by = positions[b * 3 + 1];
      const theta = Math.atan2((ay + by) * 0.5, (ax + bx) * 0.5) / (Math.PI * 2) + 0.5;

      // The z of the 2D cross product is positive when travelling a -> b turns
      // anticlockwise about the centre. Orienting every edge by that sign is
      // what lets an irregular wikilink graph circulate as one body: without
      // it, half the edges would run the other way and the circulation would
      // read as noise rather than as a current.
      const swirl = ax * by - ay * bx >= 0 ? 1 : -1;

      eTheta[e * 2] = theta;
      eTheta[e * 2 + 1] = theta;
      eSwirl[e * 2] = swirl;
      eSwirl[e * 2 + 1] = swirl;
    }

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    edgeGeo.setAttribute('aT', new THREE.BufferAttribute(eT, 1));
    edgeGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 1));
    edgeGeo.setAttribute('aOuter', new THREE.BufferAttribute(eOuter, 1));
    edgeGeo.setAttribute('aWeight', new THREE.BufferAttribute(eWeight, 1));
    edgeGeo.setAttribute('aTheta', new THREE.BufferAttribute(eTheta, 1));
    edgeGeo.setAttribute('aSwirl', new THREE.BufferAttribute(eSwirl, 1));

    return { nodeGeometry: nodeGeo, edgeGeometry: edgeGeo };
  }, [graph]);

  useEffect(() => () => nodeGeometry.dispose(), [nodeGeometry]);
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);

  /* ---- uniforms ---------------------------------------------------------- */

  const nodeUniforms = useRef({
    uTime: { value: 0 },
    uBoot: { value: 1 },
    uSize: { value: ambient ? 26 : 30 },
    uPixelRatio: { value: 1 },
    uTempo: { value: 1 },
    uSweep: { value: 0 },
    uBloom: { value: style.bloom },
    uBloomPhase: { value: 0 },
    uCore: { value: new THREE.Color(style.core) },
    uAccent: { value: new THREE.Color(style.accent) },
    uMix: { value: style.mix },
    uOpacity: { value: ambient ? 0.92 : 1 },
  });

  const edgeUniforms = useRef({
    uTime: { value: 0 },
    uBoot: { value: 1 },
    uPhase: { value: 0 },
    uSweep: { value: 0 },
    uBloom: { value: style.bloom },
    uBloomPhase: { value: 0 },
    uCore: { value: new THREE.Color(style.core) },
    uAccent: { value: new THREE.Color(style.accent) },
    uOpacity: { value: ambient ? 0.85 : 1 },
    uStaccato: { value: 0 },
    uOut: { value: Math.max(0, style.flow) },
    uIn: { value: Math.max(0, -style.flow) },
    uSwirl: { value: 1 - Math.abs(style.flow) },
  });

  /**
   * Clocks the shaders cannot keep themselves.
   *
   * Both are integrated per frame instead of being read off elapsedTime,
   * because both have a rate that changes with the state. Multiplying a raw
   * elapsed time by a new rate jumps the phase by the whole accumulated
   * difference — packets would snap to new positions and the sweep hand would
   * skip. Integrating a delta means the rate can change mid-flight and the
   * motion just speeds up or slows down.
   */
  const phaseRef = useRef(0);
  const sweepRef = useRef(0);
  /** Accumulated spin angle. Its *rate* reverses; the angle itself never jumps. */
  const spinRef = useRef(0);
  /** Drives the slow reversal of the spin direction. */
  const spinOscRef = useRef(0);
  /** Integrated bloom clock, for the same reason as phaseRef. */
  const bloomPhaseRef = useRef(0);
  const bloomRef = useRef(style.bloom);
  /** Damped -1..1 flow, and 0..1 how much of the idle wander is in play. */
  const flowRef = useRef(style.flow);
  const driftRef = useRef(style.drift);

  // Colour, tempo and flow are damped toward their target rather than snapped,
  // so a state change reads as the field shifting mood, not as a cut.
  const target = useRef({
    core: new THREE.Color(style.core),
    accent: new THREE.Color(style.accent),
    tempo: style.tempo,
    mix: style.mix,
    staccato: 0,
    flow: style.flow,
    drift: style.drift,
    bloom: style.bloom,
  });
  useEffect(() => {
    target.current.core.set(style.core);
    target.current.accent.set(style.accent);
    target.current.tempo = ambient ? style.tempo * 0.9 : style.tempo;
    target.current.mix = style.mix;
    target.current.staccato = state === 'alert' ? 1 : 0;
    target.current.flow = style.flow;
    target.current.drift = style.drift;
    target.current.bloom = style.bloom;
  }, [style, state, ambient]);

  useEffect(() => {
    const nu = nodeMatRef.current?.uniforms;
    if (nu) nu.uPixelRatio.value = Math.min(viewport.dpr, 2);
  }, [viewport.dpr]);

  useEffect(() => {
    const nu = nodeMatRef.current?.uniforms;
    const eu = edgeMatRef.current?.uniforms;
    if (nu) nu.uBoot.value = boot;
    if (eu) eu.uBoot.value = boot;
  }, [boot]);

  useFrame((frameState, delta) => {
    const nu = nodeMatRef.current?.uniforms;
    const eu = edgeMatRef.current?.uniforms;
    if (!nu || !eu) return;

    nu.uBoot.value = boot;
    eu.uBoot.value = boot;
    if (!animate) return;

    const t = frameState.clock.elapsedTime;
    nu.uTime.value = t;
    eu.uTime.value = t;

    // Frame-rate independent ease toward the current state's look.
    const k = 1 - Math.exp(-3.2 * delta);
    (nu.uCore.value as THREE.Color).lerp(target.current.core, k);
    (nu.uAccent.value as THREE.Color).lerp(target.current.accent, k);
    (eu.uCore.value as THREE.Color).lerp(target.current.core, k);
    (eu.uAccent.value as THREE.Color).lerp(target.current.accent, k);
    nu.uMix.value += (target.current.mix - nu.uMix.value) * k;
    nu.uTempo.value += (target.current.tempo - nu.uTempo.value) * k;
    eu.uStaccato.value += (target.current.staccato - eu.uStaccato.value) * k;

    // Packet travel. Integrated, so the tempo can change without teleporting
    // anything — see phaseRef.
    phaseRef.current += delta * 0.16 * nu.uTempo.value;
    eu.uPhase.value = phaseRef.current;

    // The sweep hand runs slowly at rest and quickens with the tempo, so a
    // busy SAM is scanned more often. Wrapped to 0..1 to keep float precision
    // usable over a session left open all night.
    sweepRef.current = (sweepRef.current + delta * 0.055 * (0.6 + 0.5 * nu.uTempo.value)) % 1;
    nu.uSweep.value = sweepRef.current;
    eu.uSweep.value = sweepRef.current;

    // Flow: -1 fully inward, 0 circulating, +1 fully outward. The three stream
    // weights always sum to 1, which is what keeps the crossfade in EDGE_FRAG
    // a blend rather than a brightness swing.
    flowRef.current += (target.current.flow - flowRef.current) * k;
    const flow = flowRef.current;
    eu.uOut.value = Math.max(0, flow);
    eu.uIn.value = Math.max(0, -flow);
    eu.uSwirl.value = 1 - Math.abs(flow);

    // The field opening and gathering. Integrated for the same reason as the
    // packet clock — reading sin(elapsed * tempo) would jump the whole cycle
    // the moment a state changed the tempo, so the graph would snap mid-breath.
    bloomPhaseRef.current =
      (bloomPhaseRef.current + delta * 0.80 * nu.uTempo.value) % (Math.PI * 2);
    nu.uBloomPhase.value = bloomPhaseRef.current;
    eu.uBloomPhase.value = bloomPhaseRef.current;

    bloomRef.current += (target.current.bloom - bloomRef.current) * k;
    nu.uBloom.value = bloomRef.current;
    eu.uBloom.value = bloomRef.current;

    // Damped so the graph settles into its wander rather than lurching into it.
    driftRef.current += (target.current.drift - driftRef.current) * k;
    // Ambient sits under body copy on every screen, so it wanders less than
    // the intro does — enough to be alive, not enough to pull the eye off text.
    const drift = driftRef.current * (ambient ? 0.72 : 1);

    if (groupRef.current) {
      const group = groupRef.current;

      // Idle: the graph turns on its own axis and roams the frame. Busy: it
      // damps back to the barely-there drift it always had, so "working" reads
      // as focused rather than as more of the same wandering.
      // Most of the amplitude is on the drift term rather than in the constant.
      // Measured first with the old 0.10/0.06 constants still carrying it, and
      // a busy graph wandered nearly as far as an idle one — the state made no
      // visible difference. Idle has to own the movement for it to read.
      //
      // The spin *rate* is what reverses, not the angle: integrating a rate
      // through zero eases the graph to a stop and away the other way on its
      // own, where flipping a sign on the angle would snap it. The second term
      // is deliberately incommensurate with the first so the reversals never
      // land on a beat the eye can start counting.
      spinOscRef.current += delta * 0.50;
      const spinRate =
        0.25 *
        drift *
        (Math.sin(spinOscRef.current) * 0.8 +
          Math.sin(spinOscRef.current * 0.37 + 1.3) * 0.2);
      spinRef.current += delta * spinRate;
      group.rotation.z = spinRef.current + Math.sin(t * 0.045) * 0.030;
      group.rotation.y = Math.sin(t * 0.06) * (0.05 + 0.34 * drift);
      group.rotation.x = Math.cos(t * 0.05) * (0.03 + 0.20 * drift);

      // Breathing: the whole field swells and eases on a ~10s cycle with a
      // slower sub-wave, and idle adds a much deeper swell on top. Done on the
      // group rather than per-node in the shader so the edges expand with the
      // notes — moving the nodes alone would tear them off their links.
      // The JSX `scale` prop covers the static (reduced-motion) case.
      const breath =
        1.0 +
        Math.sin(t * 0.65) * 0.014 +
        Math.sin(t * 0.17) * 0.010 +
        Math.sin(t * 0.33) * 0.090 * drift;
      group.scale.setScalar(scale * breath);

      // Lissajous wander. Two incommensurate periods, so the path never
      // repeats on a beat the eye can lock onto and start predicting.
      const reach = Math.min(viewport.width, viewport.height) * 0.110 * drift;
      group.position.x = Math.sin(t * 0.037) * reach;
      group.position.y = Math.cos(t * 0.029) * reach * 0.72;
    }
  });

  // Scale off the short axis so the whole graph is on screen — the rim should
  // just kiss the frame edge. Scaling off the long axis throws everything past
  // radius 0.5 off the top and bottom, which leaves the rim looking like
  // unconnected dust instead of the outer shell of one object.
  const scale = Math.min(viewport.width, viewport.height) * (ambient ? 0.70 : 0.54);

  return (
    <group ref={groupRef} scale={scale}>
      <lineSegments geometry={edgeGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={edgeMatRef}
          uniforms={edgeUniforms.current}
          vertexShader={EDGE_VERT}
          fragmentShader={EDGE_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <points geometry={nodeGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={nodeMatRef}
          uniforms={nodeUniforms.current}
          vertexShader={NODE_VERT}
          fragmentShader={NODE_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

/* ========================================================================== */
/* Error boundary                                                             */
/* ========================================================================== */

/** WebGL is never guaranteed. The boot screen must survive without it. */
class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[SAM] Vault graph visualiser disabled:', error);
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ========================================================================== */
/* Public component                                                           */
/* ========================================================================== */

export interface VaultGraphVisualiserProps {
  /** Overrides the global activity store. Mostly for previews and tests. */
  state?: VisualiserState;
  /** Assembly progress 0..1. Omit for a fully-formed graph. Ignored when `ambient`. */
  boot?: number;
  /**
   * Wallpaper mode, for the layer that sits behind every tab.
   *
   * The intro owns the screen; the ambient layer sits under dense body copy and
   * must never compete with it. So this paints no ground of its own (the app's
   * own gradient and grid stay visible), skips the vignette (SamBackground's
   * mask does that job), holds the graph fully assembled, and pulls size,
   * brightness and tempo well down.
   */
  ambient?: boolean;
  className?: string;
}

export function VaultGraphVisualiser({
  state,
  boot = 1,
  ambient = false,
  className,
}: VaultGraphVisualiserProps) {
  // No assembly animation on the ambient layer — it would replay on every
  // route change, which is a distraction rather than an entrance.
  const bootValue = ambient ? 1 : boot;
  const graph = useVaultGraph();
  const storeState = useSamActivity((s) => s.activity);
  const active = state ?? storeState;
  const style = STATE_STYLE[active] ?? STATE_STYLE.idle;

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const animate = !reducedMotion && visible;

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${
        ambient ? '' : 'bg-[#010812]'
      } ${className ?? ''}`}
      aria-hidden="true"
      data-testid="vault-graph-visualiser"
    >
      {/* Ambient gets a bloom too, but a transparent one — no base layer, so
          the app's own gradient and grid still read through it. Without any
          glow the nucleus dies against the page. */}
      {ambient && (
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle 15% at 50% 50%, ${style.core}30 0%, transparent 70%),
              radial-gradient(circle 40% at 50% 50%, ${style.accent}14 0%, transparent 74%)
            `,
          }}
        />
      )}

      {/* Painted ground: a bloom under the nucleus so the core reads as the
          brightest thing on screen even before a single node has resolved.
          Omitted in ambient mode — it is opaque, and would cover the app's own
          gradient and grid from globals.css. */}
      {!ambient && (
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          opacity: 0.35 + bootValue * 0.65,
          background: `
            radial-gradient(circle 13% at 50% 50%, ${style.core}47 0%, transparent 66%),
            radial-gradient(circle 34% at 50% 50%, ${style.core}24 0%, transparent 72%),
            radial-gradient(ellipse 92% 72% at 50% 50%, ${style.accent}16 0%, transparent 74%),
            linear-gradient(180deg, #010812 0%, #01060f 60%, #010812 100%)
          `,
        }}
      />
      )}

      {mounted && (
        <WebGLBoundary>
          <Canvas
            className="absolute inset-0"
            dpr={[1, 1.8]}
            frameloop={animate ? 'always' : 'demand'}
            gl={{
              antialias: false,
              alpha: true,
              powerPreference: 'high-performance',
              stencil: false,
              depth: true,
            }}
            camera={{ position: [0, 0, 3.4], fov: 55, near: 0.1, far: 40 }}
          >
            <GraphMesh
              graph={graph}
              state={active}
              boot={bootValue}
              animate={animate}
              ambient={ambient}
            />
            <AdaptiveDpr pixelated />
          </Canvas>
        </WebGLBoundary>
      )}

      {/* Vignette — holds the eye on the nucleus and hides the rim cutoff.
          Ambient mode skips it: SamBackground already applies its own mask,
          tuned for text legibility, and stacking the two crushes the field. */}
      {!ambient && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 88% 78% at 50% 50%, transparent 62%, rgba(1,8,18,0.55) 100%)',
          }}
        />
      )}
    </div>
  );
}

export default VaultGraphVisualiser;
