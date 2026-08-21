/**
 * GET /api/fleet/runs — the fleet's most recent runs, across all personas.
 *
 * Reads the retained job store (same source as /api/fleet/spend and the
 * per-persona job list), so the recent-runs list survives server restarts and
 * shows every recorded fleet run regardless of how it was dispatched — through
 * the dispatch route or the `sam-fleet-run` recording helper. Each run is
 * costed through the shared helper, so this list and the spend scan can never
 * disagree.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { costFleetJob } from '@/lib/server/fleet/jobCosts';

import type { FleetPersonaJob } from '@/types/fleet';
import type { JobStatus } from '@/types/jobs';

export const dynamic = 'force-dynamic';

const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');
const MAX_RUNS = 8;

/** A stored job's meta.json, holding the same shape as the manager's records. */
interface StoredRecord {
  command?: string;
  status?: JobStatus;
  exitCode?: number | null;
  createdAt?: string;
  endedAt?: string | null;
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const jobs: FleetPersonaJob[] = [];

  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(JOBS_ROOT);
  } catch {
    // No job store yet — an empty history is a valid answer.
  }

  for (const dir of dirs) {
    let meta: string;
    try {
      meta = await fsp.readFile(path.join(JOBS_ROOT, dir, 'meta.json'), 'utf-8');
    } catch {
      continue;
    }

    let record: StoredRecord;
    try {
      record = JSON.parse(meta) as StoredRecord;
    } catch {
      continue;
    }
    if (!record.command || !record.command.startsWith('fleet:')) continue;

    // Label shape is `fleet:<persona> (<model>) — …`, set by the dispatch
    // route and the recording helper. The model selects the costing basis.
    const match = record.command.match(/^fleet:([a-z0-9_-]+)(?:\s+\(([^)]+)\))?/);
    if (!match) continue;
    const dispatchedModel = match[2] ?? '';

    const costed = await costFleetJob(dir, dispatchedModel);

    jobs.push({
      id: dir,
      command: record.command,
      status: record.status ?? 'exited',
      exitCode: record.exitCode ?? null,
      createdAt: record.createdAt ?? new Date(0).toISOString(),
      endedAt: record.endedAt ?? null,
      model: dispatchedModel,
      costUsd: costed.costUsd,
      costBasis: costed.costBasis,
      usage: costed.usage,
      servedModel: costed.servedModel,
      durationMs: costed.durationMs,
      sessionId: costed.sessionId,
      modelMismatch: costed.modelMismatch,
    });
  }

  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const limited = jobs.slice(0, MAX_RUNS);

  return envelope({ jobs: limited }, 'sam.fleet.runs', startedAt, estate.tick);
}
