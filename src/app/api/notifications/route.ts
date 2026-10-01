/**
 * GET /api/notifications  → every ping T9's `sam-push` logged, newest first
 * (session required)
 *
 * A read, not a write — same auth level as GET /api/chats. Spec must-do 17;
 * check 12 (automated half, alongside `notifications.test.ts`).
 */

import { readNotifications } from '@/lib/server/push/notifications';
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
  return envelope(notifications, 'sam.notifications.list', startedAt, estate.tick);
}
