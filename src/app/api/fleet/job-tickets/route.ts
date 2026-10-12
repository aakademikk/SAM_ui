/**
 * GET /api/fleet/job-tickets?jobId=<id> — the job detail panel's ticket data.
 *
 * Session-gated like the floor route. A missing or malformed `jobId`, a job
 * that is not a ticket job, and `?demo=1` all answer `{ mode: 'stages' }`
 * with status 200; demo mode never reads the live store, so a screen-share
 * cannot leak a real job.
 */

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { readJobTicketPanel, type JobTicketPanel } from '@/lib/server/fleet/jobTicketPanel';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const url = new URL(request.url);
  const demo = url.searchParams.get('demo') === '1';
  const jobId = url.searchParams.get('jobId');

  let panel: JobTicketPanel = { mode: 'stages' };
  if (!demo && jobId) {
    try {
      panel = await readJobTicketPanel(jobId);
    } catch {
      panel = { mode: 'stages' };
    }
  }

  return envelope(panel, 'sam.fleet.job-tickets', startedAt, estate.tick);
}
