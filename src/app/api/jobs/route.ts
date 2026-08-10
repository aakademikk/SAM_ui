/**
 * GET  /api/jobs  → list recent jobs
 * POST /api/jobs  → create a new job (body: { command: string })
 */

import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  const manager = getJobManager();

  const jobs = await manager.list();
  return envelope(jobs, 'sam.jobs.list', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const estate = getEstate();
  const manager = getJobManager();

  const body = await readJson(request);
  const command = typeof body.command === 'string' ? body.command.trim() : '';

  if (!command) {
    return failure('Command is required.', 400);
  }

  if (command.length > 4096) {
    return failure('Command too long (max 4096 chars).', 413);
  }

  const job = await manager.create(command);
  return envelope(job, 'sam.jobs.create', startedAt, estate.tick);
}
