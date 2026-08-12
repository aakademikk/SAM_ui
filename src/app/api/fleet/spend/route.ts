/**
 * GET /api/fleet/spend — cost-to-date per persona.
 *
 * Scans the retained job store for fleet jobs (command prefix `fleet:`),
 * parses each one's stream-json for the `result` event's `total_cost_usd`,
 * and sums per persona. Fleet runs are Claude first-party, so the CLI's own
 * figure is trustworthy (unlike DeepSeek-priced tiers — see lib/costing.ts).
 *
 * Jobs are retained 7 days, so this is the last-7-days spend picture.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { readFrames } from '@/lib/server/jobs/manager';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

import type { FleetSpend } from '@/types/fleet';

export const dynamic = 'force-dynamic';

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const MAX_SCAN = 128;

/** Pull the last `total_cost_usd` seen in a job's output stream. */
async function resultCostUsd(id: string): Promise<number | null> {
  const frames = await readFrames(id, 0);
  if (frames.length === 0) return null;

  const text = Buffer.concat(frames.map((f) => f.data)).toString('utf-8');
  let cost: number | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as { total_cost_usd?: number };
      if (typeof event.total_cost_usd === 'number') cost = event.total_cost_usd;
    } catch {
      // not JSON — skip
    }
  }
  return cost;
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

    const match = record.command.match(/^fleet:([a-z0-9_-]+)/);
    if (!match) continue;
    const persona = match[1];

    spend.scannedJobs += 1;
    const cost = await resultCostUsd(dir);

    const entry = spend.personas[persona] ?? { jobs: 0, costUsd: 0 };
    entry.jobs += 1;
    if (cost !== null) entry.costUsd += cost;
    spend.personas[persona] = entry;
  }

  spend.totalCostUsd = Object.values(spend.personas).reduce((sum, e) => sum + e.costUsd, 0);

  return envelope(spend, 'sam.fleet.spend', startedAt, estate.tick);
}
