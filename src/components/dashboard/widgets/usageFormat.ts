/**
 * SAM — usageFormat: the usage tile's words (U1, U2).
 *
 * Pure functions, no DOM. Times are shown in Europe/London, 24 hour, whatever
 * the machine's zone. `now` is always passed in so the words are testable.
 */

import type { UsageWindow } from '@/types/usage';

const ZONE = 'Europe/London';

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "18:40", or "Mon 23:00" when the instant is not on the same London day as `now`. */
function clockLabel(ms: number, now: number): string {
  const time = timeFmt.format(ms);
  return dateFmt.format(ms) === dateFmt.format(now) ? time : `${dayFmt.format(ms)} ${time}`;
}

/** "read just now", "read 14 min ago", "read 3 h ago", "read 2 d ago". */
export function formatAge(readAt: string, now: number): string {
  const ms = Date.parse(readAt);
  if (!Number.isFinite(ms)) return 'read time unknown';
  const mins = Math.floor((now - ms) / 60_000);
  if (mins < 1) return 'read just now';
  if (mins < 60) return `read ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `read ${hours} h ago`;
  return `read ${Math.floor(hours / 24)} d ago`;
}

/** "resets 18:40", "resets Mon 23:00", or "reset time not recorded". */
export function formatReset(iso: string | null, now: number): string {
  if (iso === null) return 'reset time not recorded';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'reset time not recorded';
  return `resets ${clockLabel(ms, now)}`;
}

export type UsageTone = 'ok' | 'warn' | 'high' | 'reset' | 'none';

function pctTone(pct: number): UsageTone {
  if (pct >= 80) return 'high';
  if (pct >= 60) return 'warn';
  return 'ok';
}

/** The big text, the small line under it, and the tone for one window. */
export function windowLine(w: UsageWindow | null, now: number): { text: string; sub: string; tone: UsageTone } {
  if (w === null) return { text: '', sub: 'no reading yet', tone: 'none' };
  if (w.state === 'reset') {
    // U2: never a percent here, stale or otherwise.
    const ms = Date.parse(w.readAt);
    const when = Number.isFinite(ms) ? clockLabel(ms, now) : 'an unknown time';
    return { text: 'reset', sub: `not checked since ${when}`, tone: 'reset' };
  }
  const pct = w.pct;
  if (pct === null) return { text: '', sub: 'no reading yet', tone: 'none' };
  const text = `${pct}%`;
  const tone = pctTone(pct);
  if (w.state === 'unknown-reset') return { text, sub: 'reset time not recorded', tone };
  return { text, sub: formatReset(w.resetsAt, now), tone };
}
