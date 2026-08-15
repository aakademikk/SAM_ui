/**
 * SAM — report third-party fleet spend to the estate cost ledger.
 *
 * `cost_service.py` (loopback :8791) is the one place every token bill lands,
 * so the estate has a single cost picture rather than one slice per system.
 * Anthropic fleet runs are deliberately *not* reported: they are first-party,
 * already priced correctly by the CLI, and the SAM_ui spend view reads them
 * straight from the job store. Only DeepSeek runs go here, because their cost
 * is invisible to every other ledger.
 *
 * Best-effort by design. The ledger being down must never affect a job that
 * has already completed, so every failure path is a silent return.
 */

import { readFrames } from '@/lib/server/jobs/manager';
import { isDeepSeekModel } from '@/lib/fleetModels';

const LEDGER_URL = process.env.FLEET_COST_URL ?? 'http://127.0.0.1:8791/record';
const TIMEOUT_MS = 2000;

interface ResultUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}

/**
 * Last `result` event in a job's stream.
 *
 * The CLI interleaves warnings and hook chatter with its JSON and a line does
 * not reliably begin with `{`, so scan brace positions rather than requiring
 * the object to start the line.
 */
async function resultUsage(jobId: string): Promise<ResultUsage | null> {
  const frames = await readFrames(jobId, 0);
  if (frames.length === 0) return null;

  const text = Buffer.concat(frames.map((f) => f.data)).toString('utf-8');
  let usage: ResultUsage | null = null;

  for (const line of text.split('\n')) {
    if (!line.includes('"type":"result"')) continue;
    for (let i = line.indexOf('{'); i !== -1; i = line.indexOf('{', i + 1)) {
      try {
        const event = JSON.parse(line.slice(i)) as { type?: string; usage?: ResultUsage };
        if (event.type === 'result' && event.usage) {
          usage = event.usage;
          break;
        }
      } catch {
        // Not a complete object at this brace — try the next.
      }
    }
  }
  return usage;
}

/**
 * Post a completed DeepSeek fleet run's token usage to the estate ledger.
 * No-ops for Anthropic models and for runs with no usable usage block.
 */
export async function reportFleetRun(
  jobId: string,
  persona: string,
  model: string,
): Promise<void> {
  if (!isDeepSeekModel(model)) return;

  const usage = await resultUsage(jobId);
  if (!usage) return;

  // `usd` is deliberately omitted: the service prices DeepSeek from its own
  // table, which is the same single source the router uses. Sending a figure
  // computed here would create a second, drifting price list.
  const body = {
    model,
    source: `sam_ui.fleet.${persona}`,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      // Stored verbatim by the service, so the exact reasoning spend survives
      // in the ledger and does not need the original job log to audit.
      output_tokens_details: usage.output_tokens_details ?? {},
    },
    // The service persists a `thinking` boolean, and the router writes the same
    // field — so whether reasoning was suppressed is comparable across both
    // sources. It is derived here rather than assumed: MAX_THINKING_TOKENS=0 is
    // the CLI lever, and this is the measurement of whether it actually took.
    thinking: (usage.output_tokens_details?.thinking_tokens ?? 0) > 0,
    out: jobId,
  };

  try {
    await fetch(LEDGER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Ledger down, refusing, or slow. The run itself already succeeded.
  }
}
