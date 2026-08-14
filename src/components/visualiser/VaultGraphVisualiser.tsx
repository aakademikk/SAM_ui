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
 * positions instead of a proximity graph, packets that always travel
 * centre-outward, and a boot parameter that assembles the graph from nothing.
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
 * Per-state colour and tempo. Note there is no `warning` state — the store
 * calls it `alert`, and that is the red one. `listening` exists in the type but
 * nothing currently sets it.
 */
const STATE_STYLE: Record<VisualiserState, { core: string; accent: string; tempo: number; mix: number }> = {
  idle: { core: '#22d3ee', accent: '#a855f7', tempo: 1.0, mix: 0.22 },
  listening: { core: '#38bdf8', accent: '#22d3ee', tempo: 1.4, mix: 0.34 },
  thinking: { core: '#a855f7', accent: '#e879f9', tempo: 2.1, mix: 0.52 },
  speaking: { core: '#22d3ee', accent: '#5eead4', tempo: 1.75, mix: 0.46 },
  alert: { core: '#f43f5e', accent: '#fb7185', tempo: 2.7, mix: 0.78 },
};

/** Node tint by top-level folder — the vault's own structure, kept legible. */
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

const NODE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uBoot;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uTempo;

  attribute float aSeed;
  attribute float aWeight;   // 0..1 by degree — drives size and brightness
  attribute float aRadius;   // 0..1 distance from the nucleus
  attribute vec3  aColor;

  varying float vPulse;
  varying float vWeight;
  varying float vReveal;
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
    vec3 pos = position * mix(0.18, 1.0, reveal);

    // Breathing: the whole field swells slowly, each node on its own phase so
    // it never marches in step. Faster and shallower as the tempo climbs.
    float breath = sin(uTime * 0.55 * uTempo + phase) * 0.012
                 + sin(uTime * 0.21 + aRadius * 4.0) * 0.020;
    pos *= 1.0 + breath;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    vPulse = 0.5 + 0.5 * sin(uTime * 1.15 * uTempo + phase * 1.7);
    vWeight = aWeight;
    vColor = aColor;

    gl_Position = projectionMatrix * mvPosition;

    float size = uSize * mix(0.60, 2.30, pow(aWeight, 0.75));
    gl_PointSize = size * uPixelRatio * (0.80 + 0.30 * vPulse) * reveal;
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
  varying vec3  vColor;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    float halo = smoothstep(0.5, 0.0, d);
    float core = pow(halo, 7.0);
    float spec = pow(halo, 30.0);          // the hard white centre

    // Folder identity stays readable, pulled toward the state colour by uMix —
    // so a state change recolours the whole field without erasing its structure.
    vec3 stateTint = mix(uCore, uAccent, vPulse);
    vec3 color = mix(vColor, stateTint, uMix);

    // The halo skews toward the accent while the centre blows out to white,
    // which is what sells these as emissive rather than as flat dots.
    color = mix(color * 0.55 + uAccent * 0.22, color, core);
    color += vec3(spec) * (0.55 + 0.45 * vWeight);

    float alpha = (halo * 0.30 + core * 0.98 + spec * 1.15)
                * uOpacity * vReveal * (0.38 + 0.62 * vWeight);

    gl_FragColor = vec4(color, alpha);
  }
`;

const EDGE_VERT = /* glsl */ `
  uniform float uBoot;

  attribute float aT;        // 0 at the inner endpoint, 1 at the outer one
  attribute float aSeed;
  attribute float aOuter;    // radius of the outer endpoint, for reveal timing
  attribute float aWeight;

  varying float vT;
  varying float vSeed;
  varying float vReveal;
  varying float vWeight;

  void main() {
    // Edges resolve just behind the node they lead to.
    float startAt = aOuter * 0.72 + 0.05;
    vReveal = smoothstep(startAt, startAt + 0.24, uBoot);
    vT = aT;
    vSeed = aSeed;
    vWeight = aWeight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uTempo;
  uniform vec3  uCore;
  uniform vec3  uAccent;
  uniform float uOpacity;
  uniform float uStaccato;

  varying float vT;
  varying float vSeed;
  varying float vReveal;
  varying float vWeight;

  void main() {
    // Packets always run 0 -> 1, and aT is authored inner-to-outer, so energy
    // is always leaving the nucleus. Per-edge seed and speed keep it from
    // reading as a single synchronised wave.
    float speed = 0.16 * uTempo * (0.7 + vSeed * 0.7);
    float travel = fract(uTime * speed + vSeed);

    float d = abs(vT - travel);
    d = min(d, 1.0 - d);

    // Tight head with a longer trailing wake — a data pulse, not a glow worm.
    float packet = smoothstep(0.085, 0.0, d);
    float wake = smoothstep(0.26, 0.0, d) * 0.32;

    // Under alert the pulse chops rather than glides.
    packet *= mix(1.0, step(0.5, fract(uTime * 5.5 + vSeed)), uStaccato);

    // Energy dissipates as it travels out, so the rim reads as the edge of
    // SAM's reach rather than as a hard spoke drawn to it.
    float falloff = mix(1.0, 0.38, vT);

    vec3 trace = mix(uCore, uAccent, vT);
    // The packet brightens toward the core colour and only just clips to white
    // at its very centre — adding flat white was what made these read as wires.
    vec3 color = trace + uCore * packet * 0.55 + vec3(packet * packet * 0.30);

    float base = 0.052 + 0.05 * vWeight;
    float alpha = (base + packet * 0.62 + wake * 0.18) * uOpacity * vReveal * falloff;

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

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const weights = new Float32Array(count);
    const radii = new Float32Array(count);
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
    nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    /* edges — authored inner endpoint first so packets travel outward */
    const segments = graph.edges.length;
    const ePos = new Float32Array(segments * 6);
    const eT = new Float32Array(segments * 2);
    const eSeed = new Float32Array(segments * 2);
    const eOuter = new Float32Array(segments * 2);
    const eWeight = new Float32Array(segments * 2);

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
    }

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    edgeGeo.setAttribute('aT', new THREE.BufferAttribute(eT, 1));
    edgeGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 1));
    edgeGeo.setAttribute('aOuter', new THREE.BufferAttribute(eOuter, 1));
    edgeGeo.setAttribute('aWeight', new THREE.BufferAttribute(eWeight, 1));

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
    uCore: { value: new THREE.Color(style.core) },
    uAccent: { value: new THREE.Color(style.accent) },
    uMix: { value: style.mix },
    uOpacity: { value: ambient ? 0.92 : 1 },
  });

  const edgeUniforms = useRef({
    uTime: { value: 0 },
    uBoot: { value: 1 },
    uTempo: { value: 1 },
    uCore: { value: new THREE.Color(style.core) },
    uAccent: { value: new THREE.Color(style.accent) },
    uOpacity: { value: ambient ? 0.85 : 1 },
    uStaccato: { value: 0 },
  });

  // Colour and tempo are damped toward their target rather than snapped, so a
  // state change reads as the field shifting mood, not as a cut.
  const target = useRef({ core: new THREE.Color(style.core), accent: new THREE.Color(style.accent), tempo: style.tempo, mix: style.mix, staccato: 0 });
  useEffect(() => {
    target.current.core.set(style.core);
    target.current.accent.set(style.accent);
    target.current.tempo = ambient ? style.tempo * 0.9 : style.tempo;
    target.current.mix = style.mix;
    target.current.staccato = state === 'alert' ? 1 : 0;
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
    eu.uTempo.value = nu.uTempo.value;
    eu.uStaccato.value += (target.current.staccato - eu.uStaccato.value) * k;

    if (groupRef.current) {
      // Barely-there drift. Enough that the graph never reads as a still image.
      groupRef.current.rotation.z = Math.sin(t * 0.045) * 0.035;
      groupRef.current.rotation.y = Math.sin(t * 0.06) * 0.10;
      groupRef.current.rotation.x = Math.cos(t * 0.05) * 0.06;
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
