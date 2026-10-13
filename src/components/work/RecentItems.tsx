'use client';
/**
 * SAM - the recent-items list. Fetched from /api/vault/recent each time it
 * mounts (the Items view mounts it afresh on every open). A missing entry
 * shows "moved or deleted" and is not a button.
 */
import { useCallback, useEffect, useState } from 'react';
import { entryLabel, type RecentListEntry } from './recentView';

export interface RecentItemsProps {
  onOpenItem?: (path: string, from?: string) => void;
}

type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; items: RecentListEntry[] };

export function RecentItems({ onOpenItem }: RecentItemsProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    const ctl = new AbortController();
    fetch('/api/vault/recent', { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { items?: RecentListEntry[] }) => setState({ kind: 'ready', items: j.items ?? [] }))
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') setState({ kind: 'failed' });
      });
    return () => ctl.abort();
  }, []);

  useEffect(() => load(), [load]);

  if (state.kind === 'loading') return <p className="text-xs text-dim-500">Loading recent items...</p>;
  if (state.kind === 'failed') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-xs text-dim-400">Could not load recent items.</p>
        <button
          type="button"
          onClick={() => load()}
          className="min-h-[44px] min-w-[44px] rounded border border-void-700 px-4 text-xs text-dim-100"
        >
          Retry
        </button>
      </div>
    );
  }
  if (state.items.length === 0) return <p className="text-xs text-dim-500">Nothing made yet.</p>;

  const now = new Date();
  return (
    <ul className="space-y-1">
      {state.items.map((e) => {
        const l = entryLabel(e, now);
        const body = (
          <>
            <span className="block text-xs font-medium text-dim-100 truncate">{l.title}</span>
            {l.project && <span className="block text-xs text-dim-500 truncate">{l.project}</span>}
            <span className="block text-xs text-dim-400">
              {l.made} · {l.chatTitle}
            </span>
            {l.note && <span className="block text-xs text-amber-300">{l.note}</span>}
          </>
        );
        return (
          <li key={`${e.path}|${e.messageId}`}>
            {l.openable ? (
              <button
                type="button"
                onClick={() => onOpenItem?.(e.path)}
                className="w-full min-h-[44px] text-left rounded px-2 py-1.5 hover:bg-void-800 transition-colors"
              >
                {body}
              </button>
            ) : (
              <div className="w-full min-h-[44px] rounded px-2 py-1.5 opacity-60">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
