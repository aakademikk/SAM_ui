/**
 * SAM — where a notification entry's link points, client and server alike
 * (spec must-do 18, 19; review finding 14).
 *
 * Its chat if it has one, else its job output, else its own Notifications
 * entry. `src/lib/server/push/notifications.ts` re-exports this for the
 * server (`readNotifications`'s callers derive a link from a logged entry's
 * `chatId`/`jobId` rather than trusting its stored `url` verbatim); the
 * `/notifications` page imports it directly for the same rule client-side.
 * Dependency-free (no node builtins) so both sides can import the one
 * implementation with no bundling concerns.
 */
export interface NotificationLinkFields {
  id: string;
  chatId: string | null;
  jobId: string | null;
}

export function notificationTarget(entry: NotificationLinkFields): string {
  if (entry.chatId) return `/chat?c=${entry.chatId}`;
  if (entry.jobId) return `/jobs/${entry.jobId}`;
  return `/notifications?n=${entry.id}`;
}
