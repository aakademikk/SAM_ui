/**
 * GET /api/notifications  → every ping T9's `sam-push` logged, newest first
 * (session required)
 *
 * A read, not a write — same auth level as GET /api/chats. Spec must-do 17;
 * check 12 (automated half, alongside `notifications.test.ts`).
 *
 * `?n=<id>` is the id a notification's own link (`/notifications?n=<id>`)
 * asks the page to scroll to and highlight. The default page is only the
 * newest 200 entries, which an old ping's id can have aged out of — review
 * finding 13 — so when `n` names an id outside that page, it is looked up
 * across the whole log and stitched to the front, letting the client find it
 * by id exactly as it would any entry already on the page.
 */

import { findNotification, readNotifications } from '@/lib/server/push/notifications';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();

  const notifications = readNotifications();
  const wantedId = new URL(request.url).searchParams.get('n');
  if (wantedId && !notifications.some((entry) => entry.id === wantedId)) {
    const found = findNotification(wantedId);
    if (found) notifications.push(found);
  }

  return envelope(notifications, 'sam.notifications.list', startedAt, estate.tick);
}
