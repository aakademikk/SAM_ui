/**
 * GET /api/fleet/floor — the fleet floor's whole picture in one read.
 *
 * Session-gated (read-only, same trust level as the spend scan and the jobs
 * list). This is what the floor canvas and its modules poll every few
 * seconds (Must 13), so it does the one thing `readFloorState` already does
 * — a capped job-store scan, same spirit as `/api/fleet/spend`'s MAX_SCAN —
 * and wraps it in the envelope every client parser expects.
 */

import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { readFloorState } from '@/lib/server/fleet/floorState';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const state = await readFloorState();

  return envelope(state, 'sam.fleet.floor', startedAt, estate.tick);
}
