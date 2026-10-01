/**
 * GET /api/chats?archived=0|1&q=  → chat summaries (session required)
 *
 * A read, not a write — same auth level as GET /api/jobs/[id]/stream, which
 * already serves chat output. Phone and PC hitting this at the same moment
 * get the same list (spec must-do 5): `listChatSummaries` takes no device
 * input at all.
 */

import { listChatSummaries } from '@/lib/server/chat/chatActions';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const url = new URL(request.url);
  const archived = url.searchParams.get('archived') === '1';
  const q = url.searchParams.get('q') ?? undefined;

  const chats = listChatSummaries({ archived, q: q || undefined });
  return envelope(chats, 'sam.chats.list', startedAt, estate.tick);
}
