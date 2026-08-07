'use client';

import { type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';

import type { Severity } from '@/types/dashboard';
import { cn, clamp, formatRelative } from '@/lib/utils';
import { useLiveClock } from '@/hooks/useLiveClock';

/* ========================================================================== */
/* Status dot                                                                 */
/* ========================================================================== */

export type ToneName =
  | 'accent'
  | 'accent-2'
  | 'success'
  | 'warning'
  | 'critical'
  | 'muted'
  | 'info';

export const TONE_COLOR: Record<ToneName, string> = {
  accent: 'var(--sam-accent)',
  'accent-2': 'var(--sam-accent-2)',
  success: 'var(--color-toxic-400)',
  warning: 'var(--color-ember-400)',
  critical: 'var(--color-alarm-400)',
  info: 'var(--color-flux-300)',
  muted: '#64748b',
};

export const SEVERITY_TONE: Record<Severity, ToneName> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  success: 'success',
};

interface StatusDotProps {
  tone: ToneName;
  /** Emits an expanding ring — reserve it for genuinely live states. */
  pulse?: boolean;
  size?: number;
  className?: string;
  title?: string;
}

export function StatusDot({ tone, pulse = false, size = 7, className, title }: StatusDotProps) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size, color }}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      <span className="glow-dot absolute inset-0 rounded-full" style={{ background: color }} />
      {pulse && (
        <span
          className="absolute inset-0 rounded-full animate-[sam-pulse-ring_2.4s_cubic-bezier(0.16,1,0.3,1)_infinite]"
          style={{ background: color, opacity: 0.5 }}
        />
      )}
    </span>
  );
}

/* ========================================================================== */
/* Pill                                                                       */
/* ========================================================================== */

interface PillProps {
  children: ReactNode;
  tone?: ToneName;
  className?: string;
  /** Solid fill instead of the default tinted outline. */
  solid?: boolean;
}

export function Pill({ children, tone = 'accent', className, solid = false }: PillProps) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[3px] px-1.5 py-[3px] font-mono text-[9.5px] leading-none tracking-[0.12em] uppercase whitespace-nowrap',
        className,
      )}
      style={
        solid
          ? { background: color, color: '#04040b', fontWeight: 600 }
          : {
              color,
              background: `color-mix(in oklab, ${color} 13%, transparent)`,
              border: `1px solid color-mix(in oklab, ${color} 38%, transparent)`,
            }
      }
    >
      {children}
    </span>
  );
}

/* ========================================================================== */
/* Meter / progress                                                           */
/* ========================================================================== */

interface MeterProps {
  /** 0–1. */
  value: number;
  tone?: ToneName;
  className?: string;
  height?: number;
  /** Renders subtle notches so partial fills are readable at a glance. */
  segmented?: boolean;
  /** Animated diagonal stripes, for work genuinely in flight. */
  striped?: boolean;
  label?: string;
}

export function Meter({
  value,
  tone = 'accent-2',
  className,
  height = 5,
  segmented = false,
  striped = false,
  label,
}: MeterProps) {
  const color = TONE_COLOR[tone];
  const pct = clamp(value, 0, 1) * 100;

  return (
    <div
      className={cn('glass-sunken relative w-full overflow-hidden rounded-full', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: `${pct}%`,
          background: striped
            ? `repeating-linear-gradient(115deg, ${color} 0 6px, color-mix(in oklab, ${color} 55%, transparent) 6px 12px)`
            : `linear-gradient(90deg, color-mix(in oklab, ${color} 55%, transparent), ${color})`,
          boxShadow: `0 0 10px ${color}, 0 0 3px ${color} inset`,
        }}
      />
      {segmented && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(2,2,8,0.85) calc(10% - 1px) 10%)',
          }}
        />
      )}
    </div>
  );
}

/* ========================================================================== */
/* Delta                                                                      */
/* ========================================================================== */

interface DeltaProps {
  value: number;
  /** Flip when a decrease is the good outcome (burn, latency, error rate). */
  invert?: boolean;
  suffix?: string;
  className?: string;
  digits?: number;
}

export function Delta({ value, invert = false, suffix = '%', className, digits = 1 }: DeltaProps) {
  const flat = Math.abs(value) < 0.05;
  const positive = value > 0;
  const good = invert ? !positive : positive;

  const tone: ToneName = flat ? 'muted' : good ? 'success' : 'critical';
  const Icon = flat ? ArrowRight : positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn('tabular inline-flex items-center gap-0.5 text-[11px] font-medium', className)}
      style={{ color: TONE_COLOR[tone] }}
    >
      <Icon size={12} strokeWidth={2.5} />
      {flat ? '0' : Math.abs(value).toFixed(digits)}
      {suffix}
    </span>
  );
}

/* ========================================================================== */
/* Relative time                                                              */
/* ========================================================================== */

interface RelativeTimeProps {
  value: string | number | null;
  className?: string;
  prefix?: string;
}

/** Renders a placeholder until the client clock exists — never mismatches. */
export function RelativeTime({ value, className, prefix }: RelativeTimeProps) {
  const now = useLiveClock();
  const text = now === null ? '—' : formatRelative(value, now);

  return (
    <span className={cn('tabular whitespace-nowrap', className)} suppressHydrationWarning>
      {prefix}
      {text}
    </span>
  );
}

/* ========================================================================== */
/* Stat readout                                                               */
/* ========================================================================== */

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: ToneName;
  className?: string;
  align?: 'left' | 'right';
}

export function Stat({ label, value, hint, tone, className, align = 'left' }: StatProps) {
  return (
    <div className={cn('flex flex-col gap-1', align === 'right' && 'items-end text-right', className)}>
      <span className="label">{label}</span>
      <span
        className="tabular text-lg leading-none font-semibold text-slate-100"
        style={tone ? { color: TONE_COLOR[tone] } : undefined}
      >
        {value}
      </span>
      {hint && <span className="text-[10.5px] leading-tight text-slate-500">{hint}</span>}
    </div>
  );
}

/* ========================================================================== */
/* Empty / error states                                                       */
/* ========================================================================== */

export function EmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-6 text-center">
      {icon && <div className="text-void-300 opacity-60">{icon}</div>}
      <p className="max-w-[34ch] text-[11.5px] leading-relaxed text-slate-500 italic">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="max-w-[36ch] text-[11.5px] leading-relaxed text-alarm-300/90 italic">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[3px] border border-alarm-400/40 bg-alarm-500/10 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-alarm-300 uppercase transition-colors hover:bg-alarm-500/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}
