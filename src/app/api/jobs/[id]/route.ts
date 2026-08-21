/**
 * GET    /api/jobs/[id]  → job status (session required)
 * DELETE /api/jobs/[id]  → kill a running job (step-up required)
 */

import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession, requireStepUp } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

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
