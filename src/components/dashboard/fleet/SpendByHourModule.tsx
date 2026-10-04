'use client';

/**
 * SAM — Spend by hour module (Modules B, T10).
 *
 * Polls `/api/fleet/spend` directly, the same route and the same poll
 * pattern `KpiTiles` (T9) already uses for its own "Spend" tile, so the
 * figures here are byte-for-byte `costFleetJob`'s own numbers, never a
 * second implementation of the costing (Must 15).
 *
 * Deviation from the ticket's "spend by hour" framing, reported per the
 * foreman's note: `/api/fleet/spend` (`src/app/api/fleet/spend/route.ts`)
 * returns `FleetSpend.personas`, a total per persona over its 7-day
 * retention window — it carries no per-job timestamp and no per-hour
 * bucket, and this ticket's Do-not-touch list forbids changing the route's
 * computation to add one. The foreman's own fallback applies: "If
 * /api/fleet/spend does not return per-hour data, bucket from whatever
 * per-job/per-entry data it does return" — so `aggregateFleetSpend` buckets
 * the route's own per-entry data, by persona, which is also what the
 * mockup's model-split bar+legend (`e-hybrid/index.html`'s `sp-bar`/`sp-leg`,
 * Opus/Sonnet/Haiku) stands in for here: our route has no model-tier split,
 * only a persona one. The module is still named and filed as the ticket
 * specifies; the header text below says "by persona, last 7 days" rather
 * than claim an hourly breakdown this route cannot honestly provide.
 */

import { useEffect, useState } from 'react';

import { formatCost } from '@/lib/costing';
import type { FleetSpend } from '@/types/fleet';

interface SpendEnvelope {
  data?: FleetSpend;
}

function isFleetSpend(value: unknown): value is FleetSpend {
  const v = value as FleetSpend | null;
  return !!v && typeof v === 'object' && typeof v.totalCostUsd === 'number' && !!v.personas;
}

export interface SpendBar {
  persona: string;
  costUsd: number;
  jobs: number;
  /** Share of `personaTotalUsd`, 0..1 — not of `FleetSpend.totalCostUsd`, which also folds in Claude Code session usage outside any persona. */
  share: number;
}

export interface SpendAggregate {
  bars: SpendBar[];
  /** Sum of every persona's `costUsd` — excludes `spend.claude`, unlike `totalCostUsd`. */
  personaTotalUsd: number;
}

/**
 * Pure aggregation: `FleetSpend.personas` (the route's own per-entry data,
 * Must 15) regrouped into display bars, highest spend first. Never touches
 * `costFleetJob` or recomputes a single figure the route didn't already
 * hand back — it only re-sorts and re-shares numbers already present.
 */
export function aggregateFleetSpend(spend: FleetSpend | null): SpendAggregate {
  if (!spend) return { bars: [], personaTotalUsd: 0 };

  const personaTotalUsd = Object.values(spend.personas).reduce((sum, entry) => sum + entry.costUsd, 0);
  const bars = Object.entries(spend.personas)
    .map(([persona, entry]) => ({
      persona,
      costUsd: entry.costUsd,
      jobs: entry.jobs,
      share: personaTotalUsd > 0 ? entry.costUsd / personaTotalUsd : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return { bars, personaTotalUsd };
}

/** Locked palette only (Won't-do: no purple/violet) — the spec's five emerald/teal constants, cycled by bar index. */
const BAR_COLOURS = ['#3dff5a', '#9dff70', '#10b981', '#2dd4bf', '#065f46'];

function personaLabel(persona: string): string {
  return persona.length > 0 ? persona[0].toUpperCase() + persona.slice(1) : persona;
}

export interface SpendByHourModuleProps {
  /** Demo mode (T20): appends `demo=1` to the spend poll. */
  demo?: boolean;
  /** Poll URL for spend; defaults to `/api/fleet/spend`. */
  spendUrl?: string;
  spendPollMs?: number;
  className?: string;
}

export default function SpendByHourModule({
  demo = false,
  spendUrl = '/api/fleet/spend',
  spendPollMs = 5000,
  className,
}: SpendByHourModuleProps) {
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
        // keep the last good figures; the next poll tries again
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

  const { bars, personaTotalUsd } = aggregateFleetSpend(spend);

  return (
    <section
      aria-label="Spend by hour"
      className={`flex min-h-0 flex-col rounded-xl border px-3.5 py-3 ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
      }}
    >
      <header className="flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Spend
        </span>
        <span className="text-[12px]" style={{ color: '#5f7d6e' }}>
          by persona · last 7 days
        </span>
      </header>

      <b className="mt-1.5 text-[21px] leading-none font-semibold tabular-nums" style={{ color: '#3dff5a' }}>
        {spend ? formatCost(spend.totalCostUsd) : '—'}
      </b>

      {bars.length === 0 ? (
        <p className="mt-2 text-[12px]" style={{ color: '#5f7d6e' }}>
          No fleet spend yet.
        </p>
      ) : (
        <>
          <div className="mt-2.5 flex h-2 overflow-hidden rounded-full" style={{ background: 'rgba(157,255,112,.08)' }}>
            {bars.map((bar, i) => (
              <span
                key={bar.persona}
                title={`${personaLabel(bar.persona)} · ${formatCost(bar.costUsd)}`}
                style={{ flex: Math.max(bar.share, 0.001), background: BAR_COLOURS[i % BAR_COLOURS.length] }}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {bars.map((bar, i) => (
              <li key={bar.persona} className="flex items-center gap-1" style={{ color: '#98b6a6' }}>
                <i aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: BAR_COLOURS[i % BAR_COLOURS.length] }} />
                {personaLabel(bar.persona)} {formatCost(bar.costUsd)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px]" style={{ color: '#5f7d6e' }}>
            {formatCost(personaTotalUsd)} across fleet jobs
            {spend?.claude ? ` · ${formatCost(spend.claude.costUsd)} Claude Code sessions` : ''}
          </p>
        </>
      )}
    </section>
  );
}
