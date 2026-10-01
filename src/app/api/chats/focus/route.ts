/**
 * POST /api/chats/focus  → { ok: true }  (session required)
 *
 * Each device reports the chat it currently has on screen (T17 wires the
 * client side), so `turnPing.ts` can tell whether a chat that just finished
 * a turn was being looked at. A read-and-remember, not a write to any chat
 * record, so this sits at `requireSession`'s level rather than step-up's —
 * the same level GET /api/chats already uses.
 */

import { setFocus } from '@/lib/server/chat/focus';
import { envelope, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const body = await readJson(request);
  const chatId = typeof body.chatId === 'string' && body.chatId ? body.chatId : null;

  setFocus(session.device, chatId);

  return envelope({ ok: true }, 'sam.chats.focus', startedAt, estate.tick);
}
