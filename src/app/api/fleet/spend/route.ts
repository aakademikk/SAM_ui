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
 *
 * Claude Code session usage (normal sessions + subagent runs) is counted by
 * `claudeCosts()` — DeepSeek turns priced, Anthropic turns as tokens (flat
 * Pro) — and merged into the same response, so the Fleet tab shows the whole
 * estate in one place. That scan is approximate (local pricing, calendar-day
 * window) and degrades to fleet-only if it fails — see
 * `src/lib/server/claudeCosts.ts`.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

import { costFleetJob } from '@/lib/server/fleet/jobCosts';
import { claudeCosts } from '@/lib/server/claudeCosts';

import type { FleetSpend } from '@/types/fleet';

export const dynamic = 'force-dynamic';

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const MAX_SCAN = 128;

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
    const costed = await costFleetJob(dir, dispatchedModel);

    if (costed.modelMismatch) {
      spend.modelMismatches = (spend.modelMismatches ?? 0) + 1;
    }

    const entry = spend.personas[persona] ?? { jobs: 0, costUsd: 0 };
    entry.jobs += 1;
    if (costed.costUsd !== null) entry.costUsd += costed.costUsd;
    spend.personas[persona] = entry;
  }

  spend.totalCostUsd = Object.values(spend.personas).reduce((sum, e) => sum + e.costUsd, 0);

  // Merge Claude Code session usage so the tab shows the whole estate. Failure
  // degrades to fleet-only — the scan is a convenience, the job store is not.
  try {
    const claude = await claudeCosts();
    spend.claude = claude;
    spend.totalCostUsd += claude.costUsd;
  } catch {
    // Fleet-only view this call.
  }

  return envelope(spend, 'sam.fleet.spend', startedAt, estate.tick);
}
