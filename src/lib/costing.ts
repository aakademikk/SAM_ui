/**
 * SAM — Turn costing. Pure, client-safe.
 *
 * The CLI reports `total_cost_usd` for every run, but it prices all models
 * against an Anthropic rate table. Measured against DeepSeek that overstates
 * spend by ~12x ($0.2428 reported vs $0.0195 actual), which would make the
 * cheap tier look dearer than the expensive one. So any tier that ships rates
 * gets costed from its raw token counts instead.
 */

import type { TierInfo, TokenUsage, TurnCost } from '@/types/chat';

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

  const { inputMiss, cacheHit, output } = tier.rates;
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
