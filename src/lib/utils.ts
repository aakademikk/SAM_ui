import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ========================================================================== */
/* Math                                                                       */
/* ========================================================================== */

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, v: number) =>
  a === b ? 0 : clamp((v - a) / (b - a), 0, 1);

/** Frame-rate independent damping. `lambda` is roughly "speed". */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/* ========================================================================== */
/* Deterministic randomness                                                   */
/* ========================================================================== */

/** FNV-1a. Stable across server and client — safe for hydration-sensitive picks. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, seedable PRNG. */
export function makeRng(seed: number | string) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a stable element from `list` for a given seed. */
export function pick<T>(list: readonly T[], seed: string | number): T {
  const h = typeof seed === 'string' ? hashString(seed) : Math.abs(Math.trunc(seed));
  return list[h % list.length] as T;
}

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/* ========================================================================== */
/* Formatting                                                                 */
/* ========================================================================== */

const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const formatCompact = (n: number) => compactFmt.format(n);

export function formatNumber(n: number, digits = 0) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(n: number, currency = 'USD', compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(n);
}

export function formatPercent(n: number, digits = 1) {
  return `${n >= 0 ? '' : ''}${n.toFixed(digits)}%`;
}

export function formatSigned(n: number, digits = 1) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
}

export function formatBytes(mb: number) {
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Relative time. `now` is required by design: passing an explicit clock keeps
 * server and client renders identical and prevents hydration drift.
 */
export function formatRelative(iso: string | number | null, now: number): string {
  if (iso == null) return '—';
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diff = Math.round((now - then) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'out';
  if (abs < 5) return 'now';
  if (abs < 60) return `${abs}s ${suffix}`;
  if (abs < 3600) return `${Math.floor(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.floor(abs / 3600)}h ${suffix}`;
  return `${Math.floor(abs / 86400)}d ${suffix}`;
}

export function formatClock(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/* ========================================================================== */
/* Series helpers                                                             */
/* ========================================================================== */

export function seriesBounds(points: { v: number }[]) {
  if (points.length === 0) return { min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

export function trendOf(points: { v: number }[], epsilon = 0.001): 'up' | 'down' | 'flat' {
  if (points.length < 2) return 'flat';
  const first = points[0].v;
  const last = points[points.length - 1].v;
  const delta = last - first;
  const scale = Math.abs(first) || 1;
  if (Math.abs(delta) / scale < epsilon) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/* ========================================================================== */
/* Timing                                                                     */
/* ========================================================================== */

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return wrapped;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ========================================================================== */
/* Runtime coercion — the API boundary trusts nothing                         */
/* ========================================================================== */

export const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export const asNumber = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export const asBool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback;

export const asArray = <T>(v: unknown, map: (item: unknown, index: number) => T): T[] =>
  Array.isArray(v) ? v.map(map) : [];

export function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const asSeries = (v: unknown): { t: number; v: number }[] =>
  asArray(v, (p) => {
    const r = asRecord(p);
    return { t: asNumber(r.t), v: asNumber(r.v) };
  });
