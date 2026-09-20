import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

/*
 * Session-gated 2026-09-20 (SAM_ui_Audit_2026-09-20 finding 6). This route was
 * open to any client that could reach the origin, in an app where every other
 * surface is behind a passkey. The tailnet is a boundary, but it is not the
 * boundary the rest of this app relies on, and an auth model with holes in it
 * is not an auth model.
 *
 * Callers already treat a non-ok response as "no data" and fall back, so a 401
 * degrades rather than breaks: the visualiser keeps its bundled snapshot and
 * the boot readout skips the line.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(estate.getProjects(), 'sam.delivery.projects', startedAt, estate.tick);
}
