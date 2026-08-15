/**
 * SAM — Fleet job costing. Shared by the spend scan and the per-persona job
 * list so the two can never price a run differently.
 *
 * Cost basis depends on the provider, because the CLI prices every model
 * against an Anthropic rate table:
 *
 *   - Anthropic runs: trust the `result` event's `total_cost_usd`.
 *   - DeepSeek runs:  recompute from raw token counts. The CLI's figure
 *                     overstates DeepSeek by up to ~100x (measured), which
 *                     would make the cheap tier look dearer than the expensive
 *                     one and defeat the entire point of routing work to it.
 *
 * The `result` event also carries `modelUsage`, keyed by the model actually
 * served. That is checked against the model the job was dispatched on: the
 * DeepSeek endpoint answers 200 with a *different* model for an unknown id, so
 * without this a Flash job silently billed as Pro would never be noticed.
 */

import { readFrames } from '@/lib/server/jobs/manager';
import { isDeepSeekModel } from '@/lib/fleetModels';
import { DEEPSEEK_RATES } from '@/lib/server/chat/tiers';
import { deepseekWindow } from '@/lib/costing';

interface ResultEvent {
  type?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { thinking_tokens?: number };
  };
  modelUsage?: Record<string, { canonicalModel?: string; provider?: string }>;
}

export interface FleetJobCost {
  /** Null when the run produced no usable `result` event (no cost known). */
  costUsd: number | null;
  costBasis: 'computed' | 'reported';
  usage?: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
  };
  servedModel?: string;
  durationMs?: number;
  sessionId?: string;
  /**
   * DeepSeek job whose served model differed from the one dispatched. The
   * DeepSeek endpoint answers 200 with a substitute for an unknown id, so a
   * mismatch here means spend is attributed to the wrong model.
   */
  modelMismatch?: boolean;
}

/** Price a DeepSeek run from its raw token counts, in the window it ran in. */
function deepSeekCostUsd(
  model: string,
  usage: { input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number } | undefined,
): number | null {
  const table = DEEPSEEK_RATES[model];
  if (!table || !usage) return null;
  const rates = table[deepseekWindow(new Date())];
  return (
    ((usage.input_tokens ?? 0) * rates.inputMiss +
      (usage.cache_read_input_tokens ?? 0) * rates.cacheHit +
      (usage.output_tokens ?? 0) * rates.output) /
    1_000_000
  );
}

/**
 * Last `result` event in a job's stream.
 *
 * The CLI interleaves warnings and hook chatter with the JSON, and a line does
 * not reliably begin with `{` — so scan for brace positions and decode from
 * each, rather than requiring the object to start the line.
 */
async function resultEvent(id: string): Promise<ResultEvent | null> {
  const frames = await readFrames(id, 0);
  if (frames.length === 0) return null;

  const text = Buffer.concat(frames.map((f) => f.data)).toString('utf-8');
  let found: ResultEvent | null = null;

  for (const line of text.split('\n')) {
    if (!line.includes('"type":"result"')) continue;
    for (let i = line.indexOf('{'); i !== -1; i = line.indexOf('{', i + 1)) {
      try {
        const event = JSON.parse(line.slice(i)) as ResultEvent;
        if (event.type === 'result') {
          found = event;
          break;
        }
      } catch {
        // Not a complete object at this brace — try the next one.
      }
    }
  }
  return found;
}

/** Cost a completed fleet job from its persisted output. */
export async function costFleetJob(id: string, dispatchedModel: string): Promise<FleetJobCost> {
  const event = await resultEvent(id);
  if (!event) return { costUsd: null, costBasis: 'reported' };

  const cost: FleetJobCost = { costUsd: null, costBasis: 'reported' };

  if (event.usage) {
    cost.usage = {
      inputTokens: event.usage.input_tokens ?? 0,
      cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
      outputTokens: event.usage.output_tokens ?? 0,
    };
  }
  if (typeof event.duration_ms === 'number') cost.durationMs = event.duration_ms;
  if (typeof event.session_id === 'string') cost.sessionId = event.session_id;

  if (isDeepSeekModel(dispatchedModel)) {
    cost.costUsd = deepSeekCostUsd(dispatchedModel, event.usage);
    cost.costBasis = 'computed';
    const served = Object.values(event.modelUsage ?? {})
      .map((m) => m.canonicalModel)
      .filter(Boolean);
    cost.servedModel = served[0];
    if (served.length > 0 && !served.includes(dispatchedModel)) {
      cost.modelMismatch = true;
    }
  } else if (typeof event.total_cost_usd === 'number') {
    cost.costUsd = event.total_cost_usd;
  }

  return cost;
}
