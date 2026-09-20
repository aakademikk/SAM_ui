import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * /api/status — proxy for the Atwood Ops box-health collector.
 *
 * The read-only collector lives in ops-status.service (port 8792): it reads
 * outreach.db, status files, logs and systemd units straight from the box and
 * never writes to any of them. This route keeps that proven collector as the
 * single data brain and re-serves its JSON through the SAM_ui envelope so the
 * client parses it exactly like every other SAM_ui API.
 *
 * Server-to-server on 127.0.0.1 — no auth or mixed-content concerns, and the
 * page still works if the tailnet client cannot reach :8792 directly.
 */

const OPS_STATUS_URL = process.env.OPS_STATUS_URL || 'http://127.0.0.1:8792/api/status';

/*
 * Session-gated 2026-09-20 (SAM_ui_Audit_2026-09-20 finding 6). This re-serves
 * the ops collector's entire payload - outreach pool and runway, lead-finder
 * freshness, nightly backup state, the Max-tier canary and every systemd unit.
 * It was the most business-sensitive of the seven routes that were open, and
 * the /status page that consumes it is already behind a login everywhere else.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(OPS_STATUS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return failure(
      `ops-status unreachable: ${err instanceof Error ? err.message : 'fetch failed'}`,
      502,
    );
  }
  if (!res.ok) {
    return failure(`ops-status returned HTTP ${res.status}`, 502);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return failure('ops-status returned non-JSON', 502);
  }

  const estate = getEstate();
  return envelope(data, 'sam.ops', startedAt, estate.tick);
}
