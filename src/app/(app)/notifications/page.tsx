/**
 * /notifications — every ping T9's `sam-push` logged, newest first.
 *
 * Spec must-do 17, 18, 19; check 12. Each entry is a link to
 * `notificationTarget(entry)` (its chat, else its job output, else itself).
 * An entry with neither a chat nor a job links to its own
 * `/notifications?n=<id>` — arriving here with that query string does not
 * navigate away, it just scrolls to and highlights the matching row in
 * place (`scrollIntoView` + a temporary highlight class), the same way a
 * real push notification tap for that entry would land.
 *
 * No unread counts, badges or deleting (spec: won't do) — this is a plain
 * list.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

import { notificationTarget } from '@/lib/notificationTarget';
import { cn } from '@/lib/utils';

/** Mirrors `NotificationEntry` in `src/lib/server/push/notifications.ts` —
 *  the shape `GET /api/notifications` serves. Kept as its own client-side
 *  type (rather than importing the server module) the same way other pages
 *  in this app mirror their API's payload shape locally. */
interface NotificationEntry {
  id: string;
  ts: number;
  title: string;
  body: string;
  url: string;
  tag: string;
  chatId: string | null;
  jobId: string | null;
}

export default function NotificationsPage() {
  const [entries, setEntries] = useState<NotificationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // `n` rides along so the server can stitch in an entry that has aged
        // out of the default newest-200 page (review finding 13) — without
        // it, a ping's own link to an old entry would highlight nothing.
        const n = new URLSearchParams(window.location.search).get('n');
        const url = n ? `/api/notifications?n=${encodeURIComponent(n)}` : '/api/notifications';
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`notifications fetch failed (${res.status})`);
        const json = (await res.json()) as { data: NotificationEntry[] };
        if (alive) setEntries(json.data);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load notifications.');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ?n=<id> scrolls to and highlights that entry, rather than navigating
  // anywhere — this IS the page that entry's own link points at.
  useEffect(() => {
    if (!entries) return;
    const params = new URLSearchParams(window.location.search);
    const n = params.get('n');
    if (!n) return;
    setHighlightId(n);
    const row = rowRefs.current[n];
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [entries]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 space-y-4">
      <header className="flex items-center gap-2">
        <Bell size={18} className="text-accent" />
        <h1 className="text-base font-semibold text-void-100">Notifications</h1>
      </header>

      {error && (
        <div className="rounded-lg border border-alarm-400/40 bg-alarm-400/10 p-3 text-sm text-alarm-400">
          {error}
        </div>
      )}

      {!entries && !error && (
        <p className="text-sm text-dim-400">Loading…</p>
      )}

      {entries && entries.length === 0 && (
        <p className="text-sm text-dim-400">No pings yet.</p>
      )}

      {entries && entries.length > 0 && (
        <ul className="rounded-xl border border-void-700 divide-y divide-void-700 overflow-hidden">
          {entries.map((entry) => (
            <li
              key={entry.id}
              ref={(el) => {
                rowRefs.current[entry.id] = el;
              }}
              className={cn(
                'transition-colors',
                highlightId === entry.id && 'bg-accent/10',
              )}
            >
              <a
                href={notificationTarget(entry)}
                className="flex flex-col gap-0.5 px-4 py-3 bg-void-900/60 hover:bg-void-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-void-100 truncate">{entry.title}</span>
                  <span className="text-[12px] font-mono text-dim-500 shrink-0">
                    {new Date(entry.ts).toLocaleString([], {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {entry.body && (
                  <span className="text-xs text-dim-400 truncate">{entry.body}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
