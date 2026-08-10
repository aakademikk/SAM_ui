/**
 * GET  /api/jobs  → list recent jobs (session required)
 * POST /api/jobs  → create a new job (step-up required)
 */

import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession, requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const manager = getJobManager();

  const jobs = await manager.list();
  return envelope(jobs, 'sam.jobs.list', startedAt, estate.tick);
}

export async function POST(request: Request) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

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

  // Audit log
  await logCommand({
    jobId: job.id,
    command,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  return envelope(job, 'sam.jobs.create', startedAt, estate.tick);
}
