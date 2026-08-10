/**
 * POST /api/jobs/[id]/input  → write stdin to a running job
 *
 * Body: { input: string }
 */

import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await params;
  const estate = getEstate();
  const manager = getJobManager();

  const body = await readJson(request);
  const input = typeof body.input === 'string' ? body.input : '';

  if (!input) {
    return failure('Input is required.', 400);
  }

  const ok = await manager.writeStdin(id, input);
  if (!ok) {
    return failure('Job not found or not running.', 404);
  }

  return envelope({ sent: input.length }, 'sam.jobs.input', startedAt, estate.tick);
}
