import { requireSession } from '@/lib/server/auth/guard';
import { getChat } from '@/lib/server/chat/chatStore';
import { labelRecent, readRecent } from '@/lib/server/workArea/recent';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/recent — the recent work items across all chats, each
 * labelled with its chat's title and its project. Session-gated first.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const items = labelRecent(await readRecent(), (id) => getChat(id)?.title);

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
