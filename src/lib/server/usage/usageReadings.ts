import type {
  UsagePayload,
  UsageSeat,
  UsageSeatId,
  UsageWindow,
} from '@/types/usage';

/** One line of `~/.sam/quota/runs.jsonl`. Rows from before the five-hour reset
 *  was recorded lack `fiveHourResetsAt`. Reset times are epoch seconds. */
export interface QuotaRow {
  endedAt: string | null;
  seat: string | null;
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetsAt?: number | null;
  sevenDayResetsAt?: number | null;
}

const SEATS: UsageSeatId[] = ['main', 'max2'];
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

interface Candidate {
  at: number;
  row: QuotaRow;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function epochToIso(seconds: unknown): string | null {
  if (!isNum(seconds)) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toPct(utilization: number): number {
  return Math.min(100, Math.max(0, Math.round(utilization * 100)));
}

function buildWindow(
  c: Candidate | undefined,
  kind: 'fiveHour' | 'sevenDay',
  now: number,
): UsageWindow | null {
  if (!c) return null;
  const util = c.row[kind] as number;
  const readAt = new Date(c.at).toISOString();
  const resetSecs =
    kind === 'fiveHour' ? c.row.fiveHourResetsAt : c.row.sevenDayResetsAt;
  const resetsAt = epochToIso(resetSecs);

  if (resetsAt !== null) {
    const reset = Date.parse(resetsAt) <= now;
    return {
      pct: reset ? null : toPct(util),
      resetsAt,
      readAt,
      state: reset ? 'reset' : 'current',
    };
  }
  if (kind === 'fiveHour') {
    // Legacy row, no reset time: a five-hour window cannot outlive 5 hours.
    if (now - c.at > FIVE_HOURS_MS) {
      return { pct: null, resetsAt: null, readAt, state: 'reset' };
    }
    return { pct: toPct(util), resetsAt: null, readAt, state: 'unknown-reset' };
  }
  return { pct: toPct(util), resetsAt: null, readAt, state: 'current' };
}

/** Per seat and window, the reading is the newest row (by `endedAt`) with a
 *  non-null value for that window. Pure: rows in, payload out. Junk rows are
 *  skipped, never thrown on. */
export function buildUsage(rows: QuotaRow[], now: number): UsagePayload {
  const best: Record<string, { fiveHour?: Candidate; sevenDay?: Candidate }> =
    {};
  for (const id of SEATS) best[id] = {};

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.seat !== 'string' || !(row.seat in best)) continue;
    if (typeof row.endedAt !== 'string') continue;
    const at = Date.parse(row.endedAt);
    if (Number.isNaN(at)) continue;
    const slot = best[row.seat];
    for (const kind of ['fiveHour', 'sevenDay'] as const) {
      if (!isNum(row[kind])) continue;
      const cur = slot[kind];
      if (!cur || at > cur.at) slot[kind] = { at, row };
    }
  }

  const seats: UsageSeat[] = SEATS.map((id) => ({
    id,
    fiveHour: buildWindow(best[id].fiveHour, 'fiveHour', now),
    sevenDay: buildWindow(best[id].sevenDay, 'sevenDay', now),
  }));
  return { seats, generatedAt: new Date(now).toISOString() };
}
