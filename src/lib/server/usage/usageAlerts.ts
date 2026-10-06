import { formatReset } from '@/components/dashboard/widgets/usageFormat';
import type { UsagePayload, UsageWindow } from '@/types/usage';

/** Seat to the last pinged reset epoch (ms) per window. */
export type AlertState = Record<string, { fiveHour?: number; sevenDay?: number }>;

export interface UsagePing {
  seat: string;
  window: 'fiveHour' | 'sevenDay';
  pct: number;
  resetsAt: string;
  title: string;
  body: string;
  tag: string;
}

const THRESHOLD_PCT = 80;
const WINDOW_NAMES = { fiveHour: '5-hour', sevenDay: 'weekly' } as const;

/** The reset epoch (ms) a window would alert under, or null when it must not
 *  alert: no reading, reset, unknown reset time, or under the threshold. */
function alertEpoch(w: UsageWindow | null): number | null {
  if (!w || w.state !== 'current' || w.pct === null) return null;
  if (w.pct < THRESHOLD_PCT || w.resetsAt === null) return null;
  const epoch = Date.parse(w.resetsAt);
  return Number.isFinite(epoch) ? epoch : null;
}

/** Pure: the pings to send now and the state to save. A window pings once per
 *  reset epoch; a new epoch is a new window. */
export function decideAlerts(
  usage: UsagePayload,
  state: AlertState,
  now: number,
): { pings: UsagePing[]; next: AlertState } {
  const pings: UsagePing[] = [];
  const next: AlertState = {};
  for (const [seat, windows] of Object.entries(state ?? {})) {
    next[seat] = { ...windows };
  }

  for (const seat of usage.seats) {
    for (const kind of ['fiveHour', 'sevenDay'] as const) {
      const w = seat[kind];
      const epoch = alertEpoch(w);
      if (epoch === null || w === null || w.pct === null || w.resetsAt === null) continue;
      if (next[seat.id]?.[kind] === epoch) continue;
      next[seat.id] = { ...next[seat.id], [kind]: epoch };
      pings.push({
        seat: seat.id,
        window: kind,
        pct: w.pct,
        resetsAt: w.resetsAt,
        title: 'SAM usage',
        body: `${seat.id} seat: ${WINDOW_NAMES[kind]} limit at ${w.pct}%, ${formatReset(w.resetsAt, now)}`,
        tag: `usage-${seat.id}-${kind}`,
      });
    }
  }
  return { pings, next };
}
