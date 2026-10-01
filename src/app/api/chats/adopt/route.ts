/**
 * POST /api/chats/adopt  → { id }  (session required)
 *
 * T14's migration of a device's current (pre-upgrade) chat into the store,
 * so it shows up in the main list rather than being imported into Archived.
 *
 * Session, not step-up (review finding 2, 2026-10-01). The page calls this
 * once, fire-and-forget, on the first load after deploy — the moment a
 * phone's 10-minute step-up window has almost always lapsed — and the
 * legacy keys it migrates from are gone straight after, so a 401 here was
 * never retried: the first `GET /api/chats` then imported this device's own
 * current chat into Archived along with everything else (spec 14, check
 * 10a). Adopt is safe at read level because it cannot start or resume
 * anything and cannot touch an unknown chat: `chatActions.adopt` only
 * accepts an id SAM_ui itself created (`isSamuiSession`) that still has a
 * transcript on disk, and only ever creates or un-archives the record for
 * that one chat. Every other chat write (archive, restore, delete, handoff,
 * a turn) stays step-up.
 */

import { adopt } from '@/lib/server/chat/chatActions';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return failure('id is required.', 400);

  const result = adopt(id);
  if (!result.ok) return failure(result.error, result.status);

  return envelope(result.chat, 'sam.chats.adopt', startedAt, estate.tick);
}
