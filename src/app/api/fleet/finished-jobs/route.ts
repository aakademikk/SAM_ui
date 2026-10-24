/**
 * GET /api/fleet/finished-jobs[?general=<id>] (completed-jobs T6).
 *
 * The last finished jobs, newest finish first, with closer verdicts: with no
 * `general`, the fleet list (last 10 across the five Generals and SAM); with
 * one of the five, that General's last 5. `sam` is not a General here: SAM's
 * own jobs appear only on the fleet list (must-do 10), so it is a 400.
 *
 * A new route rather than `/api/fleet/jobs?persona=`, which keeps only
 * `fleet:` commands and so lists none of today's `sam-job` jobs. Session-gated
 * like that route, and read-only.
 *
 * `?demo=1` (must-do 17) returns `demoFinishedJobs`'s invented rows instead:
 * the branch comes before any call into `finishedJobs.ts`, so the live job
 * store is never read on that path.
 *
 * It does not call `getEstate()` (T16a): the estate tick advance reads every
 * `meta.json` synchronously, which cost about 270 ms a poll on a 5040-directory
 * store, so `meta.tick` is a constant 0 here.
 */

import { envelope, failure } from '@/lib/server/respond';
import { requireSession } from '@/lib/server/auth/guard';
import { demoFinishedJobs } from '@/lib/server/fleet/demoFixtures';
import { getFleetFinished, getGeneralFinished } from '@/lib/server/fleet/finishedJobs';

import { FINISHED_GENERALS } from '@/types/finishedJobs';
import type { GeneralId } from '@/types/floor';

function isGeneralId(value: string): value is GeneralId {
  return value !== 'sam' && (FINISHED_GENERALS as readonly string[]).includes(value);
}

// The envelope's tick is a constant 0: the estate tick advance reads every
// meta.json synchronously and this route does not need it; the finished lists
// have their own memo.
const TICK = 0;

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();

  const url = new URL(request.url);
  const generalParam = url.searchParams.get('general');
  const demo = url.searchParams.get('demo') === '1';

  if (generalParam !== null && !isGeneralId(generalParam)) {
    return failure(`Unknown General '${generalParam}'.`, 400);
  }
  const general = generalParam ?? undefined;

  if (demo) {
    return envelope(
      { jobs: demoFinishedJobs(Date.now(), general) },
      'sam.fleet.finished-jobs',
      startedAt,
      TICK,
    );
  }

  const jobs = general === undefined ? await getFleetFinished() : await getGeneralFinished(general);

  return envelope({ jobs }, 'sam.fleet.finished-jobs', startedAt, TICK);
}
