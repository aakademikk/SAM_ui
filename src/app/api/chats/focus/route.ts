/**
 * POST /api/chats/focus  → { ok: true }  (session required)
 *
 * Each device reports the chat it currently has on screen (T17 wires the
 * client side), so `turnPing.ts` can tell whether a chat that just finished
 * a turn was being looked at. A read-and-remember, not a write to any chat
 * record, so this sits at `requireSession`'s level rather than step-up's —
 * the same level GET /api/chats already uses.
 *
 * `focus.ts`'s map is keyed by whatever string this route hands it — it was
 * `session.device` alone until review finding 9: two tabs or windows on the
 * SAME device (phone split-screen, two PC windows) share one `device` name,
 * so the second one's 20s heartbeat silently overwrote the first's entry,
 * and Colin could get pinged about a chat he still had open in the other
 * window, or miss a ping for one nobody was actually looking at any more.
 * `tabId` (generated client-side in `sessionStorage`, so a reload keeps it
 * but a new tab does not) is folded into the key, so each tab gets its own
 * entry; a client that does not send one (old cache, a direct curl) still
 * gets the pre-fix one-entry-per-device behaviour rather than a 400.
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
  const tabId = typeof body.tabId === 'string' && body.tabId ? body.tabId : null;
  const focusKey = tabId ? `${session.device}:${tabId}` : session.device;

  setFocus(focusKey, chatId);

  return envelope({ ok: true }, 'sam.chats.focus', startedAt, estate.tick);
}
