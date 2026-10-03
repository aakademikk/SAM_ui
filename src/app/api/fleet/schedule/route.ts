/**
 * GET /api/fleet/schedule — the scheduled jobs (timers and cron) in one read.
 *
 * Session-gated (read-only, same trust level as `/api/fleet/floor`). This is
 * what the clock ring and Schedule panel (T17/T18) poll every few seconds
 * (Must 13, 28), so it wraps `readScheduledJobs`'s own bounded, read-only
 * scan (four child processes at most, regardless of timer count — see
 * `schedule.ts`) in the envelope every client parser expects.
 */

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { readScheduledJobs } from '@/lib/server/fleet/schedule';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const data = await readScheduledJobs();

  return envelope(data, 'sam.fleet.schedule', startedAt, estate.tick);
}
