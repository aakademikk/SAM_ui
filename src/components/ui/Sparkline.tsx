'use client';

import { useId, useMemo } from 'react';

import type { SeriesPoint } from '@/types/dashboard';
import { cn, seriesBounds } from '@/lib/utils';

interface SparklineProps {
  points: SeriesPoint[];
  className?: string;
  /** Stroke colour; defaults to the live ambient accent. */
  color?: string;
  /** Renders a gradient fill beneath the stroke. */
  fill?: boolean;
  strokeWidth?: number;
  /** Draws a glowing dot on the most recent sample. */
  head?: boolean;
  /** Pads the vertical range so flat series do not hug the edges. */
  padding?: number;
  height?: number;
}

const VIEW_W = 100;

/**
 * Resolution-independent sparkline. Drawn in a 100×`height` user-space box and
 * stretched with `preserveAspectRatio="none"`, so it fits any container without
 * needing a measurement pass.
 */
export function Sparkline({
  points,
  className,
  color = 'var(--sam-accent-2)',
  fill = true,
  strokeWidth = 1.5,
  head = true,
  padding = 0.12,
  height = 32,
}: SparklineProps) {
  const gradientId = useId();

  const { line, area, headPoint } = useMemo(() => {
    if (points.length < 2) {
      return { line: '', area: '', headPoint: null as { x: number; y: number } | null };
    }

    const { min, max } = seriesBounds(points);
    const span = max - min || 1;
    const pad = span * padding;
    const lo = min - pad;
    const hi = max + pad;
    const range = hi - lo || 1;

    const coords = points.map((point, index) => ({
      x: (index / (points.length - 1)) * VIEW_W,
      y: height - ((point.v - lo) / range) * height,
    }));

    const linePath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
      .join(' ');

    const last = coords[coords.length - 1];
    const areaPath = `${linePath} L${VIEW_W},${height} L0,${height} Z`;

    return { line: linePath, area: areaPath, headPoint: last };
  }, [points, height, padding]);

  if (!line) {
    return (
      <div
        className={cn('flex items-center justify-center', className)}
        style={{ height }}
        aria-hidden="true"
      >
        <div className="h-px w-full bg-void-400/50" />
      </div>
    );
  }

  return (
    <svg
      className={cn('w-full overflow-visible', className)}
      style={{ height }}
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.34" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}

      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />

      {head && headPoint && (
        <circle
          cx={headPoint.x}
          cy={headPoint.y}
          r={2}
          fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      )}
    </svg>
  );
}

interface MiniBarsProps {
  points: SeriesPoint[];
  className?: string;
  color?: string;
  height?: number;
  bars?: number;
}

/** Discrete companion to `Sparkline`, for throughput-style series. */
export function MiniBars({
  points,
  className,
  color = 'var(--sam-accent)',
  height = 30,
  bars = 28,
}: MiniBarsProps) {
  const slice = points.slice(-bars);
  const { max } = seriesBounds(slice);
  const safeMax = max || 1;

  return (
    <div
      className={cn('flex w-full items-end gap-[2px]', className)}
      style={{ height }}
      aria-hidden="true"
    >
      {slice.map((point, index) => {
        const ratio = Math.max(0.06, point.v / safeMax);
        const isLatest = index === slice.length - 1;
        return (
          <div
            key={point.t + '-' + index}
            className="flex-1 rounded-[1px] transition-[height] duration-300"
            style={{
              height: `${ratio * 100}%`,
              background: color,
              opacity: isLatest ? 1 : 0.28 + ratio * 0.5,
              boxShadow: isLatest ? `0 0 8px ${color}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
