/**
 * SAM — Chat model tiers.
 *
 * Two backends, chosen per message:
 *   fast — DeepSeek. Cheap, on a separate rate-limit pool, slower per turn.
 *   max  — whatever the Claude CLI is configured to use by default.
 *
 * The split exists for cost and quota reasons: routing every mobile message
 * through the Claude subscription competes directly with desktop work.
 *
 * No credential values live in this file. Tier env is assembled from process
 * env by name only.
 */

import type { TierId, TierInfo, TierRates } from '@/types/chat';

/* ========================================================================== */
/* Pricing — USD per 1M tokens                                                */
/* ========================================================================== */

/**
 * DeepSeek published rates. Only used for locally-computed costs; the Claude
 * tier trusts the CLI's own figure, which is accurate for first-party models.
 *
 * Peak/off-peak billing effective 2026-08-16 16:00 UTC — peak windows are
 * 01:00–04:00 and 06:00–10:00 UTC (7h/day). `old` is the flat rate in effect
 * until the switch; `offPeak`/`peak` apply after it, chosen by UTC hour.
 */
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

const DEFAULT_FAST_MODEL = 'deepseek-v4-flash';

/* ========================================================================== */
/* Tier definitions                                                            */
/* ========================================================================== */

export function fastModel(): string {
  return process.env.SAM_FAST_MODEL ?? DEFAULT_FAST_MODEL;
}

export function tierInfo(tier: TierId): TierInfo {
  if (tier === 'fast') {
    const model = fastModel();
    return {
      id: 'fast',
      label: 'Fast',
      model,
      thirdParty: true,
      // Sent to the client so spend can be computed from token counts. The
      // CLI's own total_cost_usd prices DeepSeek against an Anthropic rate
      // table and overstates it by ~12x (measured $0.2428 vs $0.0195 actual),
      // so it must never be displayed for this tier.
      rates: DEEPSEEK_RATES[model],
    };
  }
  return {
    id: 'max',
    label: 'Max',
    model: process.env.SAM_MAX_MODEL ?? 'claude (default)',
    thirdParty: false,
    // No rates: the reported figure is correct for first-party models.
  };
}

/** True when the fast tier has somewhere to point at. */
export function fastTierAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Environment overlay for a tier.
 *
 * The Next.js process loads `.env.local`, so `ANTHROPIC_BASE_URL` and friends
 * are already in `process.env` and would be inherited by any child. That means
 * the *max* tier has to explicitly delete them, or a spawned `claude` silently
 * runs against DeepSeek while the UI claims otherwise.
 */
export function tierEnv(tier: TierId): Record<string, string | null> {
  if (tier === 'fast') {
    return {
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? null,
      ANTHROPIC_MODEL: fastModel(),
    };
  }

  return {
    ANTHROPIC_BASE_URL: null,
    ANTHROPIC_AUTH_TOKEN: null,
    ANTHROPIC_API_KEY: null,
    ANTHROPIC_MODEL: process.env.SAM_MAX_MODEL ?? null,
  };
}

/* Cost is computed on the client from `TierInfo.rates` — see lib/costing.ts.
   Rates travel with the tier so the figure can be derived from the token
   counts in the stream, rather than trusting the CLI's own total_cost_usd. */
