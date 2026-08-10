/**
 * GET    /api/jobs/[id]  → job status
 * DELETE /api/jobs/[id]  → kill a running job
 */

import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await params;
  const estate = getEstate();
  const manager = getJobManager();

  const job = await manager.get(id);
  if (!job) {
    return failure('Job not found.', 404);
  }

  return envelope(job, 'sam.jobs.get', startedAt, estate.tick);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await params;
  const estate = getEstate();
  const manager = getJobManager();

  const killed = await manager.kill(id);
  if (!killed) {
    return failure('Job not found or already completed.', 404);
  }

  return envelope({ killed: id }, 'sam.jobs.kill', startedAt, estate.tick);
}
