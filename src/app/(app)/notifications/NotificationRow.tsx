/**
 * One row of the Notifications list: the ping's title, body and time.
 *
 * Collapsed, the title and body each sit on one line with an ellipsis. Tapping
 * the text expands it to the whole of both; tapping again folds it back. The
 * text is the only tap target: the question's answer buttons arrive as
 * `children`, outside the toggle, so pressing Accept or Decline never expands
 * the row. Expanded, an Open link goes where the row used to link.
 */

import type { ReactNode } from 'react';

import { notificationTarget } from '@/lib/notificationTarget';
import { cn } from '@/lib/utils';

export interface RowEntry {
  id: string;
  ts: number;
  title: string;
  body: string;
  chatId: string | null;
  jobId: string | null;
}

/** A new set with `id` flipped; other rows keep their state. */
export function toggleExpanded(open: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function NotificationRow({
  entry,
  expanded,
  onToggle,
  children,
}: {
  entry: RowEntry;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const clip = expanded ? 'break-words whitespace-pre-line' : 'truncate';
  return (
    <>
      <button
        type="button"
        data-role="toggle"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full flex-col gap-0.5 px-4 py-3 text-left bg-void-900/60 hover:bg-void-900"
      >
        <span className="flex w-full items-start justify-between gap-3">
          <span data-role="title" className={cn('min-w-0 text-sm font-medium text-void-100', clip)}>
            {entry.title}
          </span>
          <span className="text-[12px] font-mono text-dim-500 shrink-0">
            {new Date(entry.ts).toLocaleString([], {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </span>
        {entry.body && (
          <span data-role="body" className={cn('block w-full min-w-0 text-xs text-dim-400', clip)}>
            {entry.body}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3 bg-void-900/60">
          <a href={notificationTarget(entry)} className="text-xs text-accent underline">
            Open
          </a>
        </div>
      )}
      {children}
    </>
  );
}
