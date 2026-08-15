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
