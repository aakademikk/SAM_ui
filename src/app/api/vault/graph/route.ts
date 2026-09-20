import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { getVaultGraph } from '@/lib/server/vaultGraph';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/graph — the laid-out vault wikilink graph for the intro
 * visualiser. Served from an API route rather than public/ because the service
 * worker treats /api/* as NetworkFirst; a file under public/ would be precached
 * and go stale the first time the daily rebuild changed it.
 */
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
  const { graph, source } = getVaultGraph();

  return envelope(graph, `sam.vault.graph.${source}`, startedAt, estate.tick);
}
