/**
 * GET    /api/chats/[id]  → chat record + history (session required)
 * PATCH  /api/chats/[id]  → { action: 'archive' | 'restore' } (step-up required)
 * DELETE /api/chats/[id]  → remove from the app; transcript stays on disk
 *                           (step-up required)
 *
 * GET is a read (same level as the job stream). PATCH and DELETE change the
 * chat's own record, so they take the same auth as starting a turn. Archive
 * and delete are refused with 409 while a turn is running in this chat (spec
 * must-do 12) — `chatActions.ts` holds that rule; this route just relays it.
 *
 * `id` is rejected outright unless it is a well-formed UUID (review finding
 * 8) — `chatStore.ts`'s `getChat`/`update` already guard against `__proto__`
 * and friends resolving to `Object.prototype`, but checking the shape here
 * too means an id that was never going to be a real chat never reaches the
 * store at all, on any of the three methods.
 */

import { archive, openChat, remove, restore } from '@/lib/server/chat/chatActions';
import { validSessionId } from '@/lib/server/chat/startTurn';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession, requireStepUp } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const { id } = await params;
  if (!validSessionId(id)) return failure('Chat not found.', 404);

  const result = openChat(id);
  if (!result) return failure('Chat not found.', 404);

  return envelope(result, 'sam.chats.open', startedAt, estate.tick);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  const startedAt = Date.now();
  const estate = getEstate();
  const { id } = await params;
  if (!validSessionId(id)) return failure('Chat not found.', 404);
  const body = await readJson(request);

  const action = body.action;
  if (action !== 'archive' && action !== 'restore') {
    return failure("action must be 'archive' or 'restore'.", 400);
  }

  const result = action === 'archive' ? archive(id) : restore(id);
  if (!result.ok) return failure(result.error, result.status);

  return envelope(result.chat, `sam.chats.${action}`, startedAt, estate.tick);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  const startedAt = Date.now();
  const estate = getEstate();
  const { id } = await params;
  if (!validSessionId(id)) return failure('Chat not found.', 404);

  const result = remove(id);
  if (!result.ok) return failure(result.error, result.status);

  return envelope({ deleted: result.chat.id }, 'sam.chats.delete', startedAt, estate.tick);
}
