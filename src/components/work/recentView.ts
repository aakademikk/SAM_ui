/**
 * SAM - pure formatting for the recent-items list. The shape mirrors the
 * /api/vault/recent entries (redefined here: client code does not import
 * server modules).
 */

export interface RecentListEntry {
  path: string;
  chatId: string;
  messageId: string;
  at: string;
  title: string;
  missing: boolean;
  chatTitle: string;
  project: string;
}

export interface EntryLabel {
  title: string;
  project: string;
  made: string;
  chatTitle: string;
  /** "moved or deleted" for a missing entry, else null. */
  note: string | null;
  /** A missing entry is not a button. */
  openable: boolean;
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then a short date. */
export function relativeTime(at: string, now: Date): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return 'some time ago';
  const secs = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(t).toISOString().slice(0, 10);
}

export function entryLabel(entry: RecentListEntry, now: Date): EntryLabel {
  return {
    title: entry.title,
    project: entry.project,
    made: `made ${relativeTime(entry.at, now)}`,
    chatTitle: entry.chatTitle,
    note: entry.missing ? 'moved or deleted' : null,
    openable: !entry.missing,
  };
}
