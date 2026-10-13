import { requireSession } from '@/lib/server/auth/guard';
import { metaFor } from '@/lib/server/vaultMeta';
import type { ItemMeta } from '@/lib/workItems';

export const dynamic = 'force-dynamic';

const MAX_PATHS = 20;

/**
 * GET /api/vault/meta?path=<p>[&path=<p2>...][&from=<item path>] — title, kind,
 * size and availability for cards. Session-gated before any path work.
 * Refusals come back as available:false, never an error page.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const url = new URL(request.url);
  const paths = url.searchParams.getAll('path').slice(0, MAX_PATHS);
  const from = url.searchParams.get('from') ?? undefined;

  const items: ItemMeta[] = [];
  for (const p of paths) items.push(await metaFor(p, from));

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
