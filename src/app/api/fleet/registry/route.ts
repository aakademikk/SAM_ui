/**
 * GET /api/fleet/registry — the roster `--agent` can accept.
 *
 * Session required (read operation). Reads the persona files live so the
 * roster can never drift from what dispatch will accept.
 */

import { readFleetRegistry } from '@/lib/server/fleet/registry';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const personas = await readFleetRegistry();
  return envelope(personas, 'sam.fleet.registry', startedAt, estate.tick);
}
