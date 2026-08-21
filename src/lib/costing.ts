/**
 * SAM — Turn costing. Pure, client-safe.
 *
 * The CLI reports `total_cost_usd` for every run, but it prices unknown
 * models at its Opus 4.5 default ($5/$0.5 cache/$25 per MTok) — against
 * DeepSeek that overstates spend by up to ~100x (measured 2026-08-15:
 * $0.535 reported vs $0.0075 actual), which would make the cheap tier look
 * dearer than the expensive one. So any tier that ships rates gets costed
 * from its raw token counts instead.
 */

import { DEEPSEEK_RATES } from '@/lib/rates';

import type { TierInfo, TokenUsage, TurnCost } from '@/types/chat';

/** Peak windows (UTC), inclusive of start, exclusive of end: 01:00–04:00 & 06:00–10:00. */
const PEAK_HOURS = new Set([1, 2, 3, 6, 7, 8, 9]);
/** 2026-08-16 16:00 UTC — when DeepSeek's peak/off-peak rates switch on. */
const NEW_RATES_EPOCH = Date.UTC(2026, 7, 16, 16, 0, 0);

/** Which DeepSeek window a run falls in, by its wall-clock time. */
export function deepseekWindow(now: Date): 'old' | 'offPeak' | 'peak' {
  if (now.getTime() < NEW_RATES_EPOCH) return 'old';
  return PEAK_HOURS.has(now.getUTCHours()) ? 'peak' : 'offPeak';
}

export function computeCost(
  tier: TierInfo | undefined,
  usage: TokenUsage | undefined,
  reportedUsd: number | undefined,
): TurnCost | undefined {
  if (!tier) return undefined;

  if (!tier.rates) {
    return reportedUsd === undefined
      ? undefined
      : { usd: reportedUsd, basis: 'reported' };
  }

  if (!usage) return undefined;

  const { inputMiss, cacheHit, output } = tier.rates[deepseekWindow(new Date())];
  const usd =
    (usage.inputTokens * inputMiss +
      usage.cacheReadTokens * cacheHit +
      usage.outputTokens * output) /
    1_000_000;

  return { usd, basis: 'computed' };
}

/**
 * Cost a completed run by model id. DeepSeek ids are recomputed from token
 * counts at the published rates; anything else trusts the CLI's figure.
 * The fleet page has a model id but no TierInfo, so it uses this instead of
 * `computeCost`.
 */
export function computeRunCost(
  model: string,
  usage: TokenUsage | undefined,
  reportedUsd: number | undefined,
): TurnCost | undefined {
  const table = DEEPSEEK_RATES[model];
  if (!table) {
    return reportedUsd === undefined
      ? undefined
      : { usd: reportedUsd, basis: 'reported' };
  }

  if (!usage) return undefined;

  const { inputMiss, cacheHit, output } = table[deepseekWindow(new Date())];
  const usd =
    (usage.inputTokens * inputMiss +
      usage.cacheReadTokens * cacheHit +
      usage.outputTokens * output) /
    1_000_000;

  return { usd, basis: 'computed' };
}

/** Money is never rounded to nothing — sub-cent turns still deserve a figure. */
export function formatCost(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
