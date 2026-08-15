/**
 * GET /api/fleet/spend — cost-to-date per persona.
 *
 * Scans the retained job store for fleet jobs (command prefix `fleet:`) and
 * sums cost per persona. Jobs are retained 7 days, so this is the last-7-days
 * picture.
 *
 * Cost basis depends on the provider, because the CLI prices every model
 * against an Anthropic rate table:
 *
 *   - Anthropic runs: trust the `result` event's `total_cost_usd`.
 *   - DeepSeek runs:  recompute from raw token counts. The CLI's figure
 *                     overstates DeepSeek by ~12x, which would make the cheap
 *                     tier look dearer than the expensive one and defeat the
 *                     entire point of routing work to it.
 *
 * The `result` event also carries `modelUsage`, keyed by the model actually
 * served. That is checked against the model the job was dispatched on: the
 * DeepSeek endpoint answers 200 with a *different* model for an unknown id, so
 * without this a Flash job silently billed as Pro would never be noticed.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { readFrames } from '@/lib/server/jobs/manager';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

import { isDeepSeekModel } from '@/lib/fleetModels';
import { DEEPSEEK_RATES } from '@/lib/server/chat/tiers';
import { deepseekWindow } from '@/lib/costing';

import type { FleetSpend } from '@/types/fleet';

export const dynamic = 'force-dynamic';

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const MAX_SCAN = 128;

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

interface ResultEvent {
  type?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { thinking_tokens?: number };
  };
  modelUsage?: Record<string, { canonicalModel?: string; provider?: string }>;
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

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const spend: FleetSpend = { personas: {}, totalCostUsd: 0, scannedJobs: 0 };

  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(JOBS_ROOT);
  } catch {
    // No job store yet — return an empty spend.
  }

  for (const dir of dirs) {
    if (spend.scannedJobs >= MAX_SCAN) break;

    let meta: string;
    try {
      meta = await fsp.readFile(path.join(JOBS_ROOT, dir, 'meta.json'), 'utf-8');
    } catch {
      continue;
    }

    let record: { command?: string };
    try {
      record = JSON.parse(meta) as { command?: string };
    } catch {
      continue;
    }
    if (!record.command || !record.command.startsWith('fleet:')) continue;

    // Label shape is `fleet:<persona> (<model>) — …`, set by the dispatch
    // route. The model is what selects the costing basis, so it is load-bearing
    // here, not decoration.
    const match = record.command.match(/^fleet:([a-z0-9_-]+)(?:\s+\(([^)]+)\))?/);
    if (!match) continue;
    const persona = match[1];
    const dispatchedModel = match[2] ?? '';

    spend.scannedJobs += 1;
    const event = await resultEvent(dir);

    let cost: number | null = null;
    if (event) {
      if (isDeepSeekModel(dispatchedModel)) {
        cost = deepSeekCostUsd(dispatchedModel, event.usage);
        // Served-model check. Only meaningful for DeepSeek: Anthropic aliases
        // resolve to a dated id, so a string compare there is noise.
        const served = Object.values(event.modelUsage ?? {})
          .map((m) => m.canonicalModel)
          .filter(Boolean);
        if (served.length > 0 && !served.includes(dispatchedModel)) {
          spend.modelMismatches = (spend.modelMismatches ?? 0) + 1;
        }
      } else if (typeof event.total_cost_usd === 'number') {
        cost = event.total_cost_usd;
      }
    }

    const entry = spend.personas[persona] ?? { jobs: 0, costUsd: 0 };
    entry.jobs += 1;
    if (cost !== null) entry.costUsd += cost;
    spend.personas[persona] = entry;
  }

  spend.totalCostUsd = Object.values(spend.personas).reduce((sum, e) => sum + e.costUsd, 0);

  return envelope(spend, 'sam.fleet.spend', startedAt, estate.tick);
}
