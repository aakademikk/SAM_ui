/**
 * SAM — provider rate tables. Pure data, client-safe (same rule as
 * lib/costing.ts and lib/fleetModels.ts).
 *
 * One source of truth, shared by the chat tiers, the fleet spend scan,
 * transcript costing and the fleet page's per-run cost line.
 *
 * DeepSeek published rates. Peak/off-peak billing effective 2026-08-16 16:00
 * UTC — peak windows are 01:00–04:00 and 06:00–10:00 UTC (7h/day). `old` is
 * the flat rate in effect until the switch; `offPeak`/`peak` apply after it,
 * chosen by UTC hour.
 */

import type { TierRates } from '@/types/chat';

export const DEEPSEEK_RATES: Record<string, TierRates> = {
  // DeepSeek V4.1-Flash, shipped 2026-09-10 as `deepseek-flash`. Cheaper than
  // the v4-flash it replaces on every axis. `old` mirrors `offPeak` because the
  // model postdates the 2026-08-16 rate switch — the flat legacy window can
  // never apply to it.
  'deepseek-flash': {
    old: { inputMiss: 0.15, cacheHit: 0.003, output: 0.6 },
    offPeak: { inputMiss: 0.15, cacheHit: 0.003, output: 0.6 },
    peak: { inputMiss: 0.3, cacheHit: 0.006, output: 1.2 },
  },
  // Retired 2026-09-10, kept deliberately: transcripts and ledger lines from
  // before the rename are keyed by this id, and `computeRunCost` falls back to
  // the CLI's ~100x-overstated figure for any id missing from this table.
  'deepseek-v4-flash': {
    old: { inputMiss: 0.14, cacheHit: 0.0028, output: 0.28 },
    offPeak: { inputMiss: 0.22, cacheHit: 0.007, output: 0.66 },
    peak: { inputMiss: 0.44, cacheHit: 0.014, output: 1.32 },
  },
  'deepseek-v4-pro': {
    old: { inputMiss: 0.435, cacheHit: 0.003625, output: 0.87 },
    offPeak: { inputMiss: 0.66, cacheHit: 0.022, output: 1.98 },
    peak: { inputMiss: 1.32, cacheHit: 0.044, output: 3.96 },
  },
};

/**
 * Gemini published rates, USD per 1M tokens. Flat — no peak/off-peak windows,
 * so the DeepSeek-shaped `old`/`offPeak`/`peak` fields all carry the same
 * figure. The proxy reports no cache tokens today, so `cacheHit` rarely
 * surfaces; it is held at the input rate so spend is never understated.
 */
export const GEMINI_RATES: Record<string, TierRates> = {
  'gemini-2.5-flash': {
    old: { inputMiss: 0.3, cacheHit: 0.3, output: 2.5 },
    offPeak: { inputMiss: 0.3, cacheHit: 0.3, output: 2.5 },
    peak: { inputMiss: 0.3, cacheHit: 0.3, output: 2.5 },
  },
};
