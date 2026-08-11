'use client';

import { useId } from 'react';

import { cn, clamp } from '@/lib/utils';

interface GaugeProps {
  /** 0–100. */
  value: number;
  label?: string;
  sublabel?: string;
  size?: number;
  className?: string;
  /** Below this the gauge turns amber; below `criticalAt`, red. */
  warnAt?: number;
  criticalAt?: number;
  /** Inverts the thresholds for metrics where high is bad (CPU, memory). */
  invert?: boolean;
  ticks?: number;
}

const SWEEP = 252; // degrees of arc — leaves a gap at the bottom
const START = 144; // degrees, measured clockwise from 3 o'clock

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, radius: number, fromDeg: number, toDeg: number) {
  const start = polar(cx, cy, radius, fromDeg);
  const end = polar(cx, cy, radius, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/**
 * Radial gauge with a graduated bezel. The arc colour is derived from the
 * value, so a glance at hue is enough — the number is confirmation.
 */
export function Gauge({
  value,
  label,
  sublabel,
  size = 128,
  className,
  warnAt = 70,
  criticalAt = 88,
  invert = false,
  ticks = 24,
}: GaugeProps) {
  const gradientId = useId();
  const safeValue = clamp(value, 0, 100);

  const breached = invert
    ? { warn: safeValue >= warnAt, critical: safeValue >= criticalAt }
    : { warn: safeValue <= warnAt, critical: safeValue <= criticalAt };

  const color = breached.critical
    ? 'var(--color-alarm-400)'
    : breached.warn
      ? 'var(--color-ember-400)'
      : 'var(--sam-accent-2)';

  const cx = 50;
  const cy = 50;
  const radius = 38;
  const endDeg = START + (safeValue / 100) * SWEEP;

  return (
    <div className={cn('relative inline-flex flex-col items-center', className)} style={{ width: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label ?? 'Gauge'}: ${safeValue.toFixed(0)}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Bezel graduations */}
        {Array.from({ length: ticks }, (_, i) => {
          const deg = START + (i / (ticks - 1)) * SWEEP;
          const active = deg <= endDeg;
          const inner = polar(cx, cy, 44, deg);
          const outer = polar(cx, cy, active ? 48 : 46.5, deg);
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={active ? color : 'currentColor'}
              strokeOpacity={active ? 0.85 : 0.18}
              strokeWidth={1.1}
              strokeLinecap="round"
              className="text-dim-200"
            />
          );
        })}

        {/* Track */}
        <path
          d={arcPath(cx, cy, radius, START, START + SWEEP)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.16}
          strokeWidth={6}
          strokeLinecap="round"
          className="text-dim-200"
        />

        {/* Value arc */}
        {safeValue > 0.5 && (
          <path
            d={arcPath(cx, cy, radius, START, endDeg)}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={6}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: 'd 600ms cubic-bezier(0.16,1,0.3,1)' }}
          />
        )}

        {/* Needle tip */}
        {safeValue > 0.5 &&
          (() => {
            const tip = polar(cx, cy, radius, endDeg);
            return <circle cx={tip.x} cy={tip.y} r={3} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />;
          })()}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tabular text-2xl leading-none font-semibold"
          style={{ color, textShadow: `0 0 14px ${color}66` }}
        >
          {safeValue.toFixed(safeValue >= 100 ? 0 : 1)}
        </span>
        {label && <span className="label mt-1.5">{label}</span>}
        {sublabel && <span className="mt-1 text-[10px] text-slate-500">{sublabel}</span>}
      </div>
    </div>
  );
}
