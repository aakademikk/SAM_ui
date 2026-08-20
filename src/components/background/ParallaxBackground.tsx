'use client';

/**
 * SAM — Parallax neural background.
 *
 * Three layers, composited under the entire console:
 *   1. `DataCitySkyline` — receding emissive columns (ref: data-city.jpg).
 *   2. `NeuralMesh`      — a live node graph with packets travelling the edges
 *                          (ref: neural-net1.jpg).
 *   3. A CSS vignette + grid painted by `globals.css`.
 *
 * The camera drifts against pointer position, so the whole field parallaxes
 * with a slight lag — present, never distracting. Everything scales off the
 * `backgroundIntensity` preference: at 0 the canvas unmounts entirely and the
 * GPU goes back to sleep.
 */

import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import * as THREE from 'three';

import type { AmbientTheme } from '@/types/dashboard';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { clamp, damp, makeRng } from '@/lib/utils';

/* ========================================================================== */
/* Palette                                                                    */
/* ========================================================================== */

const THEME_COLORS: Record<AmbientTheme, { a: string; b: string; edge: string; city: string }> = {
  void: { a: '#a855f7', b: '#22d3ee', edge: '#7c3aed', city: '#6d28d9' },
  plasma: { a: '#c026d3', b: '#f472b6', edge: '#a21caf', city: '#86198f' },
  toxic: { a: '#22d3ee', b: '#4ade80', edge: '#06b6d4', city: '#0e7490' },
  ember: { a: '#fb923c', b: '#f43f5e', edge: '#ea580c', city: '#9a3412' },
  ghost: { a: '#94a3b8', b: '#67e8f9', edge: '#64748b', city: '#334155' },
  emerald: { a: '#3dff5a', b: '#9dff70', edge: '#10b981', city: '#065f46' },
};

/* ========================================================================== */
/* Graph construction                                                         */
/* ========================================================================== */

interface Graph {
  count: number;
  base: Float32Array;
  seeds: Float32Array;
  scales: Float32Array;
  edges: Uint16Array;
  edgeSeeds: Float32Array;
}

/**
 * Builds a proximity graph inside a flattened ellipsoid. Nodes only connect to
 * neighbours within `linkRadius`, and each node is capped at `maxLinks` so the
 * mesh stays legible instead of collapsing into a solid sheet.
 */
function buildGraph(count: number, linkRadius = 7.4, maxLinks = 3): Graph {
  const rng = makeRng('sam-neural-mesh');
  const base = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const scales = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Rejection-free spherical sampling, then squash Y and stretch Z for depth.
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const radius = 12 + Math.pow(rng(), 0.6) * 26;

    base[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    base[i * 3 + 1] = Math.cos(phi) * radius * 0.46;
    base[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius * 0.75 - 8;

    seeds[i] = rng();
    scales[i] = 0.45 + Math.pow(rng(), 2) * 1.9;
  }

  const edgeList: number[] = [];
  const linkCount = new Uint8Array(count);
  const radiusSq = linkRadius * linkRadius;

  for (let i = 0; i < count; i++) {
    if (linkCount[i] >= maxLinks) continue;
    for (let j = i + 1; j < count; j++) {
      if (linkCount[i] >= maxLinks) break;
      if (linkCount[j] >= maxLinks) continue;

      const dx = base[i * 3] - base[j * 3];
      const dy = base[i * 3 + 1] - base[j * 3 + 1];
      const dz = base[i * 3 + 2] - base[j * 3 + 2];
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < radiusSq) {
        edgeList.push(i, j);
        linkCount[i]++;
        linkCount[j]++;
      }
    }
  }

  const edgeSeeds = new Float32Array(edgeList.length);
  for (let e = 0; e < edgeList.length / 2; e++) {
    const seed = rng();
    edgeSeeds[e * 2] = seed;
    edgeSeeds[e * 2 + 1] = seed;
  }

  return {
    count,
    base,
    seeds,
    scales,
    edges: new Uint16Array(edgeList),
    edgeSeeds,
  };
}

/* ========================================================================== */
/* Shaders                                                                    */
/* ========================================================================== */

const NODE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uAmplitude;

  attribute float aSeed;
  attribute float aScale;

  varying float vPulse;
  varying float vDepth;

  void main() {
    vec3 pos = position;

    // Each node breathes on its own phase so the field never marches in step.
    float phase = aSeed * 6.28318;
    pos.x += sin(uTime * 0.32 + phase) * uAmplitude * (0.4 + aSeed);
    pos.y += cos(uTime * 0.27 + phase * 1.7) * uAmplitude * 0.7;
    pos.z += sin(uTime * 0.19 + phase * 0.6) * uAmplitude * 0.9;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;

    vPulse = 0.5 + 0.5 * sin(uTime * 1.4 + phase);
    vDepth = clamp(1.0 - dist / 78.0, 0.0, 1.0);

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * aScale * (0.62 + 0.55 * vPulse) * uPixelRatio * (26.0 / max(dist, 1.0));
  }
`;

const NODE_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying float vPulse;
  varying float vDepth;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;

    float core = smoothstep(0.5, 0.0, d);
    float hot  = pow(core, 6.0);

    vec3 color = mix(uColorA, uColorB, vPulse);
    color += vec3(hot) * 0.55;

    float alpha = (core * 0.30 + hot * 0.85) * uOpacity * (0.25 + 0.75 * vDepth);
    gl_FragColor = vec4(color, alpha);
  }
`;

const EDGE_VERT = /* glsl */ `
  attribute float aT;
  attribute float aEdgeSeed;

  varying float vT;
  varying float vSeed;
  varying float vDepth;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = clamp(1.0 - (-mvPosition.z) / 86.0, 0.0, 1.0);
    vT = aT;
    vSeed = aEdgeSeed;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  varying float vT;
  varying float vSeed;
  varying float vDepth;

  void main() {
    // A packet of signal running the length of each edge.
    float travel = fract(uTime * 0.14 + vSeed);
    float d = abs(vT - travel);
    d = min(d, 1.0 - d);
    float packet = smoothstep(0.16, 0.0, d);

    vec3 color = mix(uColorA, uColorB, vT);
    color += vec3(packet) * 0.4;

    float alpha = uOpacity * (0.11 + packet * 0.8) * (0.2 + 0.8 * vDepth);
    gl_FragColor = vec4(color, alpha);
  }
`;

/* ========================================================================== */
/* Neural mesh                                                                */
/* ========================================================================== */

interface LayerProps {
  intensity: number;
  theme: AmbientTheme;
  animate: boolean;
}

function NeuralMesh({ intensity, theme, animate }: LayerProps) {
  const { size, viewport } = useThree();

  // Node budget scales with both intensity and viewport — a phone does not get
  // the same field as a 5K display.
  const nodeCount = useMemo(() => {
    const areaFactor = clamp((size.width * size.height) / (1920 * 1080), 0.45, 1);
    return Math.round((150 + intensity * 260) * areaFactor);
  }, [intensity, size.width, size.height]);

  const graph = useMemo(() => buildGraph(nodeCount), [nodeCount]);
  const colors = THEME_COLORS[theme];

  const groupRef = useRef<THREE.Group>(null);
  const nodeUniforms = useRef({
    uTime: { value: 0 },
    uSize: { value: 13 },
    uPixelRatio: { value: 1 },
    uAmplitude: { value: 1.5 },
    uColorA: { value: new THREE.Color(colors.a) },
    uColorB: { value: new THREE.Color(colors.b) },
    uOpacity: { value: 0.85 },
  });
  const edgeUniforms = useRef({
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color(colors.edge) },
    uColorB: { value: new THREE.Color(colors.b) },
    uOpacity: { value: 0.8 },
  });

  // Edge geometry is a flat list of segment endpoints resolved from the graph.
  const edgeGeometry = useMemo(() => {
    const segments = graph.edges.length / 2;
    const positions = new Float32Array(segments * 6);
    const tValues = new Float32Array(segments * 2);
    const seeds = new Float32Array(segments * 2);

    for (let e = 0; e < segments; e++) {
      const a = graph.edges[e * 2];
      const b = graph.edges[e * 2 + 1];

      positions[e * 6] = graph.base[a * 3];
      positions[e * 6 + 1] = graph.base[a * 3 + 1];
      positions[e * 6 + 2] = graph.base[a * 3 + 2];
      positions[e * 6 + 3] = graph.base[b * 3];
      positions[e * 6 + 4] = graph.base[b * 3 + 1];
      positions[e * 6 + 5] = graph.base[b * 3 + 2];

      tValues[e * 2] = 0;
      tValues[e * 2 + 1] = 1;
      seeds[e * 2] = graph.edgeSeeds[e * 2];
      seeds[e * 2 + 1] = graph.edgeSeeds[e * 2 + 1];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(tValues, 1));
    geometry.setAttribute('aEdgeSeed', new THREE.BufferAttribute(seeds, 1));
    return geometry;
  }, [graph]);

  const nodeGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(graph.base.slice(), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(graph.seeds, 1));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(graph.scales, 1));
    return geometry;
  }, [graph]);

  useEffect(() => () => nodeGeometry.dispose(), [nodeGeometry]);
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);

  useEffect(() => {
    nodeUniforms.current.uColorA.value.set(colors.a);
    nodeUniforms.current.uColorB.value.set(colors.b);
    edgeUniforms.current.uColorA.value.set(colors.edge);
    edgeUniforms.current.uColorB.value.set(colors.b);
  }, [colors]);

  useEffect(() => {
    nodeUniforms.current.uPixelRatio.value = Math.min(viewport.dpr, 2);
    nodeUniforms.current.uOpacity.value = 0.35 + intensity * 0.6;
    nodeUniforms.current.uAmplitude.value = animate ? 0.9 + intensity * 1.6 : 0;
    edgeUniforms.current.uOpacity.value = 0.3 + intensity * 0.62;
  }, [intensity, viewport.dpr, animate]);

  useFrame((state, delta) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    nodeUniforms.current.uTime.value = t;
    edgeUniforms.current.uTime.value = t;

    if (groupRef.current) {
      // A slow yaw keeps the mesh from ever reading as a static texture.
      groupRef.current.rotation.y += delta * 0.012;
      groupRef.current.rotation.x = Math.sin(t * 0.08) * 0.04;
    }
  });

  return (
    <group ref={groupRef}>
      <lineSegments geometry={edgeGeometry} frustumCulled={false}>
        <shaderMaterial
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
/* Data city                                                                  */
/* ========================================================================== */

/** Emissive columns receding into fog — the vertical structure of data-city.jpg. */
function DataCitySkyline({ intensity, theme, animate }: LayerProps) {
  const count = Math.round(46 + intensity * 46);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colors = THEME_COLORS[theme];

  const instances = useMemo(() => {
    const rng = makeRng('sam-data-city');
    return Array.from({ length: count }, () => ({
      x: (rng() - 0.5) * 120,
      z: -34 - rng() * 90,
      height: 4 + Math.pow(rng(), 1.7) * 46,
      width: 0.22 + rng() * 0.7,
      phase: rng() * Math.PI * 2,
      tint: rng(),
    }));
  }, [count]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    const colorA = new THREE.Color(colors.city);
    const colorB = new THREE.Color(colors.b);
    const scratch = new THREE.Color();

    instances.forEach((instance, i) => {
      dummy.position.set(instance.x, -22 + instance.height / 2, instance.z);
      dummy.scale.set(instance.width, instance.height, instance.width);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, scratch.copy(colorA).lerp(colorB, instance.tint));
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances, colors]);

  useFrame((state) => {
    if (!animate || !meshRef.current) return;
    // Barely-there drift; the skyline should read as parallax, not motion.
    meshRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.05) * 1.6;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0.16 + intensity * 0.2}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

/* ========================================================================== */
/* Camera rig                                                                 */
/* ========================================================================== */

function ParallaxRig({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  const pointer = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) return;

    const onPointerMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    // Recentre when the pointer leaves so the field settles rather than sticks.
    const onPointerLeave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [enabled]);

  useFrame((_state, delta) => {
    const targetX = enabled ? pointer.current.x * 4.2 : 0;
    const targetY = enabled ? -pointer.current.y * 2.6 : 0;

    // Damped, frame-rate independent — the lag is the effect.
    current.current.x = damp(current.current.x, targetX, 2.2, delta);
    current.current.y = damp(current.current.y, targetY, 2.2, delta);

    camera.position.x = current.current.x;
    camera.position.y = current.current.y;
    camera.lookAt(0, 0, -6);
  });

  return null;
}

/* ========================================================================== */
/* Error boundary                                                             */
/* ========================================================================== */

/**
 * WebGL is not guaranteed — blocked contexts, exhausted GPU memory, and
 * headless environments all fail here. The console must survive without it.
 */
class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[SAM] Background renderer disabled:', error);
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ========================================================================== */
/* Public component                                                           */
/* ========================================================================== */

export function ParallaxBackground() {
  const intensity = useUserPreferencesStore((s) => s.backgroundIntensity);
  const theme = useUserPreferencesStore((s) => s.ambientTheme);
  const parallaxEnabled = useUserPreferencesStore((s) => s.parallaxEnabled);
  const reducedMotion = useUserPreferencesStore((s) => s.reducedMotion);

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const colors = THEME_COLORS[theme];
  const animate = !reducedMotion && visible;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
      data-testid="parallax-background"
    >
      {/* Painted base — always present, so the console never renders on bare black. */}
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{
          background: `
            radial-gradient(ellipse 90% 60% at 22% 8%, ${colors.a}22 0%, transparent 60%),
            radial-gradient(ellipse 70% 50% at 82% 22%, ${colors.b}1c 0%, transparent 62%),
            radial-gradient(ellipse 120% 80% at 50% 108%, ${colors.edge}18 0%, transparent 70%),
            linear-gradient(180deg, #05050d 0%, #020207 55%, #04040c 100%)
          `,
        }}
      />

      {mounted && intensity > 0.02 && (
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
            camera={{ position: [0, 0, 42], fov: 62, near: 0.1, far: 220 }}
            style={{ opacity: 0.55 + intensity * 0.45 }}
          >
            <fog attach="fog" args={['#03030a', 34, 128]} />
            <ParallaxRig enabled={parallaxEnabled && !reducedMotion} />
            <DataCitySkyline intensity={intensity} theme={theme} animate={animate} />
            <NeuralMesh intensity={intensity} theme={theme} animate={animate} />
            <AdaptiveDpr pixelated />
            <Preload all />
          </Canvas>
        </WebGLBoundary>
      )}

      {/* Vignette — pushes focus back to the glass panels. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 78% 64% at 50% 42%, transparent 34%, rgba(2,2,7,0.62) 100%)',
        }}
      />
    </div>
  );
}

export default ParallaxBackground;
