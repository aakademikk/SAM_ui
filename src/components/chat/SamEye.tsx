'use client';

/**
 * SAM — the eye.
 *
 * A machined optical assembly in the HAL 9000 lineage: brushed housing, bolted
 * bezel, a smoked glass dome with a fixed specular highlight, and a mechanical
 * iris of eight blades that dilates with SAM's state. The core is the tell —
 * its colour and cadence encode mood before any text is rendered.
 *
 * Everything is SVG plus motion values. The iris `d` attributes are driven by
 * springs rather than React state, so dilation animates at display refresh
 * rate without re-rendering the tree.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

import type { SamMood } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';

const BLADES = 8;
const LENS_RADIUS = 30;

interface MoodProfile {
  /** Aperture radius, in the 100×100 view box. */
  aperture: number;
  core: string;
  halo: string;
  /** Seconds per breath cycle. */
  pulse: number;
  intensity: number;
}

const MOOD: Record<SamMood, MoodProfile> = {
  idle: { aperture: 15, core: '#ff3b30', halo: '#ff6b45', pulse: 4.6, intensity: 0.82 },
  thinking: { aperture: 10.5, core: 'var(--sam-accent-2)', halo: 'var(--sam-accent)', pulse: 1.15, intensity: 1 },
  speaking: { aperture: 17.5, core: 'var(--sam-accent)', halo: 'var(--sam-accent-2)', pulse: 0.7, intensity: 1 },
  alert: { aperture: 21, core: '#ff2015', halo: '#ff7a3d', pulse: 0.5, intensity: 1 },
  annoyed: { aperture: 11.5, core: '#fb923c', halo: '#f43f5e', pulse: 2.1, intensity: 0.9 },
  pleased: { aperture: 16.5, core: '#4ade80', halo: '#22d3ee', pulse: 2.9, intensity: 0.95 },
};

const MOOD_LABEL: Record<SamMood, string> = {
  idle: 'standing by',
  thinking: 'processing',
  speaking: 'transmitting',
  alert: 'escalating',
  annoyed: 'unimpressed',
  pleased: 'satisfied',
};

/* ========================================================================== */

/**
 * One iris blade. `twist` rotates the inner edge as the aperture closes, which
 * is what makes a real diaphragm read as mechanical rather than as a circle
 * that shrinks.
 */
function bladePath(index: number, aperture: number): string {
  const step = (Math.PI * 2) / BLADES;
  const start = index * step - Math.PI / 2;
  const end = start + step;

  // Closed apertures twist further — the blades slide over one another.
  const twist = (1 - aperture / LENS_RADIUS) * 0.55 + 0.22;
  const r = Math.max(0.4, aperture);

  const outerStart = { x: 50 + LENS_RADIUS * Math.cos(start), y: 50 + LENS_RADIUS * Math.sin(start) };
  const outerEnd = { x: 50 + LENS_RADIUS * Math.cos(end), y: 50 + LENS_RADIUS * Math.sin(end) };
  const innerEnd = { x: 50 + r * Math.cos(end + twist), y: 50 + r * Math.sin(end + twist) };
  const innerStart = { x: 50 + r * Math.cos(start + twist), y: 50 + r * Math.sin(start + twist) };

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${LENS_RADIUS} ${LENS_RADIUS} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `L ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export interface SamEyeProps {
  mood: SamMood;
  size?: number;
  className?: string;
  /** Renders the mood caption beneath the assembly. */
  showLabel?: boolean;
}

export function SamEye({ mood, size = 132, className, showLabel = false }: SamEyeProps) {
  const reducedMotion = useUserPreferencesStore((s) => s.reducedMotion);
  const uid = useId();

  const profile = MOOD[mood];
  const [blinking, setBlinking] = useState(false);

  /* --- Involuntary blink -------------------------------------------------- */
  useEffect(() => {
    if (reducedMotion) return;
    let timeout: ReturnType<typeof setTimeout>;

    const schedule = () => {
      // Irregular intervals; a metronome blink reads as a loading spinner.
      timeout = setTimeout(
        () => {
          setBlinking(true);
          setTimeout(() => setBlinking(false), 150);
          schedule();
        },
        5_000 + Math.random() * 9_000,
      );
    };

    schedule();
    return () => clearTimeout(timeout);
  }, [reducedMotion]);

  const target = blinking ? 1.2 : profile.aperture;
  const aperture = useSpring(target, { stiffness: 210, damping: 20, mass: 0.55 });

  useEffect(() => {
    aperture.set(target);
  }, [target, aperture]);

  // Hook count is fixed because BLADES is a module constant.
  const blade0 = useTransform(aperture, (v) => bladePath(0, v));
  const blade1 = useTransform(aperture, (v) => bladePath(1, v));
  const blade2 = useTransform(aperture, (v) => bladePath(2, v));
  const blade3 = useTransform(aperture, (v) => bladePath(3, v));
  const blade4 = useTransform(aperture, (v) => bladePath(4, v));
  const blade5 = useTransform(aperture, (v) => bladePath(5, v));
  const blade6 = useTransform(aperture, (v) => bladePath(6, v));
  const blade7 = useTransform(aperture, (v) => bladePath(7, v));
  const bladePaths = [blade0, blade1, blade2, blade3, blade4, blade5, blade6, blade7];

  const coreScale = useTransform(aperture, [1, LENS_RADIUS], [0.28, 1]);

  const bolts = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
        return { x: 50 + 43.5 * Math.cos(angle), y: 50 + 43.5 * Math.sin(angle), key: i };
      }),
    [],
  );

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* Ambient bloom cast onto the surrounding glass */}
        <motion.div
          className="pointer-events-none absolute -inset-4 rounded-full blur-2xl"
          style={{ background: profile.halo, opacity: 0.2 }}
          animate={
            reducedMotion
              ? { opacity: 0.18 }
              : { opacity: [0.1, 0.28 * profile.intensity, 0.1] }
          }
          transition={{ duration: profile.pulse, repeat: Infinity, ease: 'easeInOut' }}
        />

        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          className="relative"
          role="img"
          aria-label={`SAM optical sensor — ${MOOD_LABEL[mood]}`}
        >
          <defs>
            {/* Brushed metal housing */}
            <linearGradient id={`${uid}-housing`} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0%" stopColor="#3a3a4d" />
              <stop offset="22%" stopColor="#15151f" />
              <stop offset="50%" stopColor="#2a2a38" />
              <stop offset="78%" stopColor="#0e0e16" />
              <stop offset="100%" stopColor="#33333f" />
            </linearGradient>

            <linearGradient id={`${uid}-bezel`} x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0%" stopColor="#4a4a5e" />
              <stop offset="45%" stopColor="#101018" />
              <stop offset="100%" stopColor="#2b2b3a" />
            </linearGradient>

            {/* Lens barrel: light falls off toward the aperture */}
            <radialGradient id={`${uid}-barrel`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#000000" />
              <stop offset="62%" stopColor="#05050c" />
              <stop offset="100%" stopColor="#191926" />
            </radialGradient>

            <radialGradient id={`${uid}-core`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="22%" stopColor={profile.core} stopOpacity="1" />
              <stop offset="62%" stopColor={profile.core} stopOpacity="0.55" />
              <stop offset="100%" stopColor={profile.halo} stopOpacity="0" />
            </radialGradient>

            {/* Dome specular — a fixed light source above and to the left */}
            <linearGradient id={`${uid}-specular`} x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>

            <clipPath id={`${uid}-lensclip`}>
              <circle cx="50" cy="50" r={LENS_RADIUS} />
            </clipPath>
          </defs>

          {/* ---- Outer housing ---- */}
          <circle cx="50" cy="50" r="49" fill={`url(#${uid}-housing)`} />
          <circle cx="50" cy="50" r="49" fill="none" stroke="#000" strokeOpacity="0.85" strokeWidth="1" />
          <circle cx="50" cy="50" r="46.5" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="0.6" />

          {/* ---- Bolts ---- */}
          {bolts.map((bolt) => (
            <g key={bolt.key}>
              <circle cx={bolt.x} cy={bolt.y} r="1.7" fill="#0b0b12" />
              <circle cx={bolt.x} cy={bolt.y} r="1.7" fill="none" stroke="#5a5a70" strokeOpacity="0.5" strokeWidth="0.35" />
              <line
                x1={bolt.x - 0.9}
                y1={bolt.y}
                x2={bolt.x + 0.9}
                y2={bolt.y}
                stroke="#6b6b85"
                strokeOpacity="0.45"
                strokeWidth="0.3"
              />
            </g>
          ))}

          {/* ---- Machined bezel ---- */}
          <circle cx="50" cy="50" r="39" fill={`url(#${uid}-bezel)`} />
          <circle cx="50" cy="50" r="39" fill="none" stroke="#000" strokeOpacity="0.7" strokeWidth="0.8" />

          {/* Knurling */}
          {Array.from({ length: 60 }, (_, i) => {
            const angle = (i / 60) * Math.PI * 2;
            const inner = 34.2;
            const outer = 37.4;
            return (
              <line
                key={i}
                x1={50 + inner * Math.cos(angle)}
                y1={50 + inner * Math.sin(angle)}
                x2={50 + outer * Math.cos(angle)}
                y2={50 + outer * Math.sin(angle)}
                stroke="#6f6f8c"
                strokeOpacity={i % 5 === 0 ? 0.42 : 0.16}
                strokeWidth={i % 5 === 0 ? 0.7 : 0.4}
              />
            );
          })}

          <circle cx="50" cy="50" r="32.5" fill="#08080f" />
          <circle cx="50" cy="50" r="32.5" fill="none" stroke="#7a7a99" strokeOpacity="0.22" strokeWidth="0.5" />

          {/* ---- Lens barrel + iris ---- */}
          <g clipPath={`url(#${uid}-lensclip)`}>
            <circle cx="50" cy="50" r={LENS_RADIUS} fill={`url(#${uid}-barrel)`} />

            {/* Core glow behind the blades */}
            <motion.circle
              cx="50"
              cy="50"
              r="26"
              fill={`url(#${uid}-core)`}
              style={{ scale: coreScale, transformOrigin: '50px 50px' }}
              animate={
                reducedMotion
                  ? { opacity: profile.intensity }
                  : {
                      opacity: [
                        profile.intensity * 0.62,
                        profile.intensity,
                        profile.intensity * 0.62,
                      ],
                    }
              }
              transition={{ duration: profile.pulse, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Aperture blades */}
            {bladePaths.map((d, i) => (
              <motion.path
                key={i}
                d={d}
                fill={i % 2 === 0 ? '#12121c' : '#0b0b14'}
                stroke="#4d4d66"
                strokeOpacity="0.32"
                strokeWidth="0.35"
              />
            ))}

            {/* Hot pupil. Scaled rather than radius-animated — `r` is an SVG
                attribute, and driving it from a keyframe array leaves the first
                frame undefined. */}
            <motion.circle
              cx="50"
              cy="50"
              r="3.4"
              fill="#ffffff"
              animate={
                reducedMotion
                  ? { opacity: 0.85, scale: 1 }
                  : { opacity: [0.55, 1, 0.55], scale: [0.78, 1.12, 0.78] }
              }
              transition={{ duration: profile.pulse * 0.85, repeat: Infinity, ease: 'easeInOut' }}
              style={{ filter: `drop-shadow(0 0 5px ${profile.core})`, transformOrigin: '50px 50px' }}
            />

            {/* Sensor sweep across the glass */}
            {!reducedMotion && (
              <motion.rect
                x="-40"
                y="0"
                width="26"
                height="100"
                fill="#ffffff"
                opacity="0.045"
                animate={{ x: [-40, 110] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'linear', repeatDelay: 2.4 }}
              />
            )}
          </g>

          {/* ---- Dome glass ---- */}
          <circle cx="50" cy="50" r={LENS_RADIUS} fill="none" stroke="#000" strokeOpacity="0.9" strokeWidth="1.4" />
          <path
            d="M 26 34 A 30 30 0 0 1 68 26 A 34 34 0 0 0 26 34 Z"
            fill={`url(#${uid}-specular)`}
          />
          <ellipse cx="40" cy="35" rx="11" ry="6.5" fill="#ffffff" opacity="0.07" transform="rotate(-28 40 35)" />

          {/* ---- Rim light ---- */}
          <circle
            cx="50"
            cy="50"
            r="32.5"
            fill="none"
            stroke={profile.core}
            strokeOpacity="0.3"
            strokeWidth="0.7"
            style={{ filter: `drop-shadow(0 0 4px ${profile.core})` }}
          />
        </svg>
      </div>

      {showLabel && (
        <span
          className="font-mono text-[9px] tracking-[0.22em] uppercase transition-colors"
          style={{ color: profile.core }}
        >
          {MOOD_LABEL[mood]}
        </span>
      )}
    </div>
  );
}

export { MOOD_LABEL };
