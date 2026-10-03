'use client';

/**
 * SAM — KPI tiles (Modules A, T9).
 *
 * The small summary strip above the fleet floor: spend, jobs today, and how
 * many Generals are busy right now. Spend comes straight from
 * `/api/fleet/spend`'s `totalCostUsd` — the same figure the Fleet tab and the
 * spend-by-hour module show, costed by the one shared `costFleetJob` helper
 * (Must 15) — never recomputed here. Jobs-today and the busy/idle count are
 * read from the `FloorState` a parent already polls (T1/T5): one slab per
 * General tower is a job verified today, one `FloorWorker` still on the floor
 * is a job queued or running right now. Neither of those is invented — a
 * General's idle flag and a tower's slab count are both honest reads off the
 * live job store, same as the floor canvas itself.
 *
 * No percentage bars, no progress meters — just the numbers (Must 14's "no
 * percentage bars" rule is about Job detail, but the same restraint applies
 * here: these are counts, not gauges).
 */

import { useEffect, useState } from 'react';

import { formatCost } from '@/lib/costing';
import type { FloorState, GeneralId } from '@/types/floor';
import type { FleetSpend } from '@/types/fleet';

const GENERAL_IDS: readonly GeneralId[] = [
  'hermes',
  'hephaestus',
  'calliope',
  'cerberus',
  'prometheus',
];

export interface KpiTilesProps {
  /** The floor's current state, from a parent that already polls `/api/fleet/floor` (T5/T11). Null before the first load. */
  state: FloorState | null;
  /** Demo mode (T20): appends `demo=1` to the spend poll. */
  demo?: boolean;
  /** Poll URL for spend; defaults to `/api/fleet/spend`. */
  spendUrl?: string;
  spendPollMs?: number;
  className?: string;
}

interface SpendEnvelope {
  data?: FleetSpend;
}

function isFleetSpend(value: unknown): value is FleetSpend {
  const v = value as FleetSpend | null;
  return !!v && typeof v === 'object' && typeof v.totalCostUsd === 'number' && !!v.personas;
}

export default function KpiTiles({
  state,
  demo = false,
  spendUrl = '/api/fleet/spend',
  spendPollMs = 5000,
  className,
}: KpiTilesProps) {
  const [spend, setSpend] = useState<FleetSpend | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctl: AbortController | null = null;
    const url = demo ? spendUrl + (spendUrl.includes('?') ? '&' : '?') + 'demo=1' : spendUrl;

    const poll = async () => {
      ctl = new AbortController();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        if (res.ok) {
          const json = (await res.json()) as SpendEnvelope;
          if (!stopped && isFleetSpend(json.data)) setSpend(json.data);
        }
      } catch {
        // keep the last good figure; the next poll tries again
      }
      if (!stopped) timer = setTimeout(poll, spendPollMs);
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ctl?.abort();
    };
  }, [spendUrl, demo, spendPollMs]);

  const busyCount = state ? GENERAL_IDS.filter((id) => !state.generals[id]?.idle).length : 0;
  const idleCount = GENERAL_IDS.length - busyCount;

  const verifiedToday = state
    ? GENERAL_IDS.reduce((sum, id) => sum + (state.towers[id] ?? 0), 0)
    : 0;
  const runningNow = state
    ? GENERAL_IDS.reduce((sum, id) => sum + state.generals[id].workers.length, 0) +
      state.samWorkers.length
    : 0;
  const jobsToday = verifiedToday + runningNow;

  const spendLabel = spend ? formatCost(spend.totalCostUsd) : '—';

  return (
    <section
      aria-label="Fleet KPI tiles"
      className={`grid grid-cols-3 gap-3.5 ${className ?? ''}`}
    >
      <Tile label="Spend" value={spendLabel} accent />
      <Tile
        label="Jobs today"
        value={String(jobsToday)}
        sub={state ? `${verifiedToday} verified · ${runningNow} running` : undefined}
      />
      <Tile
        label="Generals busy"
        value={`${busyCount} of ${GENERAL_IDS.length}`}
        sub={`${idleCount} idle`}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-col justify-center rounded-[10px] border px-4 py-2.5"
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
      }}
    >
      <span
        className="text-[11px] font-semibold tracking-[0.1em] uppercase"
        style={{ color: '#5f7d6e' }}
      >
        {label}
      </span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        <b
          className="text-[21px] leading-none font-semibold tracking-tight tabular-nums"
          style={{ color: accent ? '#3dff5a' : '#e8f7ee' }}
        >
          {value}
        </b>
        {sub ? (
          <small className="truncate text-[11px] font-medium" style={{ color: '#98b6a6' }}>
            {sub}
          </small>
        ) : null}
      </span>
    </div>
  );
}
