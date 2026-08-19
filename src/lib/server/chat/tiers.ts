/**
 * SAM — Chat model tiers.
 *
 * Three tiers, chosen per message:
 *   fast — DeepSeek flash. Cheap, on a separate rate-limit pool, slower per turn.
 *   pro  — DeepSeek pro. Same endpoint, stronger model, ~3x the cost of fast.
 *   max  — whatever the Claude CLI is configured to use by default.
 *
 * The split exists for cost and quota reasons: routing every mobile message
 * through the Claude subscription competes directly with desktop work, and
 * the two DeepSeek tiers split cheap and strong without touching that quota.
 *
 * No credential values live in this file. Tier env is assembled from process
 * env by name only.
 */

import type { TierId, TierInfo } from '@/types/chat';

import { DEEPSEEK_RATES } from '@/lib/rates';

/* Rate tables live in @/lib/rates — pure data, client-safe, shared by the
   chat tiers, the fleet spend scan, transcript costing and the fleet page's
   per-run cost line. Re-exported here so existing server importers stay put. */
export { DEEPSEEK_RATES };

const DEFAULT_FAST_MODEL = 'deepseek-v4-flash';
const DEFAULT_PRO_MODEL = 'deepseek-v4-pro';

/* ========================================================================== */
/* Tier definitions                                                            */
/* ========================================================================== */

export function fastModel(): string {
  return process.env.SAM_FAST_MODEL ?? DEFAULT_FAST_MODEL;
}

export function proModel(): string {
  return process.env.SAM_PRO_MODEL ?? DEFAULT_PRO_MODEL;
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
      // CLI's own total_cost_usd prices unknown models at its Opus 4.5 default
      // ($5/$0.5 cache/$25 per MTok), overstating DeepSeek by up to ~100x
      // (measured 2026-08-15: $0.535 reported vs $0.0075 actual), so it must
      // never be displayed for this tier.
      rates: DEEPSEEK_RATES[model],
    };
  }
  if (tier === 'pro') {
    const model = proModel();
    return {
      id: 'pro',
      label: 'Pro',
      model,
      thirdParty: true,
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

/** True when either DeepSeek tier has somewhere to point at. */
export function deepseekTierAvailable(): boolean {
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
  if (tier === 'fast') return deepseekEnv(fastModel());
  if (tier === 'pro') return deepseekEnv(proModel());

  return {
    ANTHROPIC_BASE_URL: null,
    ANTHROPIC_AUTH_TOKEN: null,
    ANTHROPIC_API_KEY: null,
    ANTHROPIC_MODEL: process.env.SAM_MAX_MODEL ?? null,
  };
}

/** Env overlay for a DeepSeek tier — same endpoint, different model. */
function deepseekEnv(model: string): Record<string, string | null> {
  return {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? null,
    ANTHROPIC_MODEL: model,
    // DeepSeek's Anthropic-compatible endpoint reasons by default, billing the
    // thinking block as output and delaying the visible answer. Kill it, as the
    // fleet helper already does (record-fleet-run.mjs). Measured ~2.9x output
    // bloat + 11% empty answers with reasoning on (Fleet_Model_Routing).
    MAX_THINKING_TOKENS: '0',
  };
}

/* Cost is computed on the client from `TierInfo.rates` — see lib/costing.ts.
   Rates travel with the tier so the figure can be derived from the token
   counts in the stream, rather than trusting the CLI's own total_cost_usd. */
