/**
 * GET /api/fleet/floor — the fleet floor's whole picture in one read.
 *
 * Session-gated (read-only, same trust level as the spend scan and the jobs
 * list). This is what the floor canvas and its modules poll every few
 * seconds (Must 13), so it does the one thing `readFloorState` already does
 * — a capped job-store scan, same spirit as `/api/fleet/spend`'s MAX_SCAN —
 * and wraps it in the envelope every client parser expects.
 *
 * `?demo=1` (Must 18, 19, T20) returns `demoFloorStateAt`'s invented state
 * instead — the live job store is never read on this path, so no real job
 * name or cost can leak into a demo screen-share.
 */

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { demoFloorStateAt } from '@/lib/server/fleet/demoFixtures';
import { readFloorState } from '@/lib/server/fleet/floorState';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const url = new URL(request.url);
  const demo = url.searchParams.get('demo') === '1';

  const state = demo ? demoFloorStateAt(Date.now()) : await readFloorState();

  return envelope(state, 'sam.fleet.floor', startedAt, estate.tick);
}
