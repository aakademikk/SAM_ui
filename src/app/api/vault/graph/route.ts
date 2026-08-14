import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { getVaultGraph } from '@/lib/server/vaultGraph';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/graph — the laid-out vault wikilink graph for the intro
 * visualiser. Served from an API route rather than public/ because the service
 * worker treats /api/* as NetworkFirst; a file under public/ would be precached
 * and go stale the first time the daily rebuild changed it.
 */
export async function GET() {
  const startedAt = Date.now();
  const estate = getEstate();
  const { graph, source } = getVaultGraph();

  return envelope(graph, `sam.vault.graph.${source}`, startedAt, estate.tick);
}
