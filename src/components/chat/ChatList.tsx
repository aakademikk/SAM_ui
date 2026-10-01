/**
 * ChatList — every chat the account can see, on both screen sizes.
 *
 * The same component renders two ways: an in-flow sidebar on desktop and an
 * overlay drawer on the phone, the same split `WorkPanel` uses — the page
 * decides nothing here beyond passing `open`/`onClose`. The main list's data
 * always comes from the server via the page's poll (spec must-do 4, 5); this
 * component only reaches into `chatsService` itself for the two things the
 * page does not already hold: the Archived list (fetched on demand, since
 * polling an inactive tab would be wasted work) and the archive/restore/
 * delete actions themselves (spec must-do 9a, 10, 11, 12).
 */

'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ArrowRightLeft, MoreVertical, Plus, Trash2, X as XIcon } from 'lucide-react';

import type { ChatSummary, ChatTier } from '@/types/chat';
import { formatRelative } from '@/lib/utils';
import { filterChatTitles } from '@/lib/chatListFilter';
import {
  StepUpRequiredError,
  archiveChat,
  deleteChat,
  listChats as listChatsFromServer,
  restoreChat,
} from '@/lib/chatsService';

export interface ChatListProps {
  chats: ChatSummary[];
  currentId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Drawer visibility on the phone — ignored by the desktop sidebar, which
   *  is always shown. */
  open: boolean;
  onClose: () => void;
  /** Called after archive, restore or delete succeeds, so the page can
   *  re-poll the main list (`chats` above) without waiting out the 5s
   *  interval. Optional only so a caller mid-upgrade still compiles. */
  onChanged?: () => void;
  /** Called when the chat on screen (`currentId`) is the one just archived
   *  or deleted, so the page can point the screen at a fresh draft instead
   *  of leaving it on a chat that no longer shows anywhere live. Never
   *  called for restore. */
  onCurrentRemoved?: () => void;
}

type ListMode = 'main' | 'archived';

const TIER_LABEL: Record<ChatTier, string> = {
  fast: 'Fast',
  pro: 'Pro',
  max: 'Max',
  max2: 'Max 2',
  gemini: 'Gemini',
  unknown: 'Unknown',
};

/** One row's pending action state, shared by both the desktop and phone
 *  renders of the same list — built once in `ChatList` below and handed down
 *  to every `ChatRow`. */
interface RowActions {
  mode: ListMode;
  busyId: string | null;
  openMenuId: string | null;
  errorId: string | null;
  errorMessage: string | null;
  onToggleMenu: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onRequestDelete: (id: string) => void;
}

function ChatRow({
  chat,
  active,
  actions,
  onOpen,
}: {
  chat: ChatSummary;
  active: boolean;
  actions: RowActions;
  onOpen: (id: string) => void;
}) {
  const menuOpen = actions.openMenuId === chat.id;
  const disabled = chat.running || actions.busyId === chat.id;
  const title = chat.title || 'Untitled chat';

  return (
    <li className="relative border-b border-void-800/60" data-chat-menu-root>
      <div className={`flex items-stretch ${active ? 'bg-accent/10 border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'}`}>
        <button
          type="button"
          onClick={() => onOpen(chat.id)}
          className={`flex-1 min-w-0 flex flex-col gap-1 px-3 py-2.5 text-left transition-colors ${
            active ? '' : 'hover:bg-void-800/60'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {chat.running && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0"
                title="A turn is running"
              />
            )}
            <span className={`text-sm truncate ${active ? 'text-accent' : 'text-dim-100'}`}>{title}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-dim-500">
            <span className="px-1.5 py-0.5 rounded bg-void-800 border border-void-700 text-dim-400">
              {TIER_LABEL[chat.tier]}
            </span>
            <span>{formatRelative(chat.lastActiveAt, Date.now())}</span>
          </div>
        </button>

        <div className="relative shrink-0 flex items-center pr-1">
          <button
            type="button"
            onClick={() => actions.onToggleMenu(chat.id)}
            aria-label={`${title} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`p-1.5 rounded transition-colors ${
              menuOpen ? 'text-dim-100 bg-void-800' : 'text-dim-500 hover:text-dim-100 hover:bg-void-800'
            }`}
          >
            <MoreVertical size={14} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 w-36 rounded-md border border-void-700 bg-void-900 py-1 shadow-lg"
            >
              {actions.mode === 'archived' ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => actions.onRestore(chat.id)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs text-dim-200 hover:bg-void-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArchiveRestore size={12} /> Restore
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => actions.onArchive(chat.id)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs text-dim-200 hover:bg-void-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Archive size={12} /> Archive
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => actions.onRequestDelete(chat.id)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-void-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Handed off (spec must-do 9b): the old chat links to the new one it
          handed off to; the new chat links back. Siblings of the open-button
          above, not nested inside it — a <button> inside a <button> is
          invalid HTML and would fire both. */}
      {chat.handedOffTo && (
        <div className="px-3 pb-2 -mt-1">
          <button
            type="button"
            onClick={() => onOpen(chat.handedOffTo as string)}
            className="flex items-center gap-1 text-[10px] text-dim-500 hover:text-accent transition-colors"
          >
            <ArrowRightLeft size={10} /> Handed off — open new chat
          </button>
        </div>
      )}
      {chat.handedOffFrom && (
        <div className="px-3 pb-2 -mt-1">
          <button
            type="button"
            onClick={() => onOpen(chat.handedOffFrom as string)}
            className="flex items-center gap-1 text-[10px] text-dim-500 hover:text-accent transition-colors"
          >
            <ArrowRightLeft size={10} /> Continued from an earlier chat
          </button>
        </div>
      )}

      {actions.errorId === chat.id && actions.errorMessage && (
        <p className="px-3 pb-2 -mt-1 text-[10px] text-red-400">{actions.errorMessage}</p>
      )}
    </li>
  );
}

/** The search box and Main/Archived switch, shared by both renders. */
function ListControls({
  mode,
  onModeChange,
  query,
  onQueryChange,
}: {
  mode: ListMode;
  onModeChange: (mode: ListMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  return (
    <div className="px-3 py-2 border-b border-void-800 shrink-0 flex flex-col gap-1.5">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search titles"
        aria-label="Search chat titles"
        className="w-full px-2 py-1.5 text-xs rounded border border-void-700 bg-void-950 text-dim-100
                   placeholder:text-dim-600 focus:outline-none focus:border-accent/60"
      />
      <div className="flex gap-1">
        {(['main', 'archived'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`flex-1 px-2 py-1 text-[11px] rounded transition-colors ${
              mode === m ? 'bg-accent/15 text-accent' : 'text-dim-400 hover:text-dim-100 hover:bg-void-800'
            }`}
          >
            {m === 'main' ? 'Main' : 'Archived'}
          </button>
        ))}
      </div>
    </div>
  );
}

function ListRows({
  chats,
  currentId,
  mode,
  actions,
  onOpen,
  archivedLoading,
  archivedError,
}: {
  chats: ChatSummary[];
  currentId: string;
  mode: ListMode;
  actions: RowActions;
  onOpen: (id: string) => void;
  archivedLoading: boolean;
  archivedError: string | null;
}) {
  if (mode === 'archived' && archivedLoading && chats.length === 0) {
    return <p className="px-3 py-4 text-xs text-dim-500">Loading…</p>;
  }
  if (mode === 'archived' && archivedError) {
    return <p className="px-3 py-4 text-xs text-red-400">{archivedError}</p>;
  }
  if (chats.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-dim-500">
        {mode === 'archived' ? 'Nothing archived.' : 'No chats yet.'}
      </p>
    );
  }
  return (
    <>
      {chats.map((chat) => (
        <ChatRow key={chat.id} chat={chat} active={chat.id === currentId} actions={actions} onOpen={onOpen} />
      ))}
    </>
  );
}

export function ChatList({ chats, currentId, onOpen, onNew, open, onClose, onChanged, onCurrentRemoved }: ChatListProps) {
  const [mode, setMode] = useState<ListMode>('main');
  const [query, setQuery] = useState('');

  const [archivedChats, setArchivedChats] = useState<ChatSummary[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Archived is fetched on demand, not polled — nothing else in the app
  // needs it, and Colin only looks at it occasionally.
  const refreshArchived = () => {
    setArchivedLoading(true);
    setArchivedError(null);
    listChatsFromServer({ archived: true })
      .then((list) => setArchivedChats(list))
      .catch((err) => {
        setArchivedError(err instanceof Error ? err.message : 'Could not load Archived.');
      })
      .finally(() => setArchivedLoading(false));
  };

  useEffect(() => {
    // Switching into Archived is the only trigger — refreshArchived reads
    // no reactive state of its own beyond what this effect already keys on.
    if (mode === 'archived') refreshArchived();
  }, [mode]);

  // Dismiss the open row menu on an outside click or Escape — same pattern
  // WidgetFrame's ellipsis menu uses.
  useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const insideAMenu = Array.from(document.querySelectorAll('[data-chat-menu-root]')).some((el) =>
        el.contains(target),
      );
      if (!insideAMenu) setOpenMenuId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenuId]);

  // Escape closes the drawer — the work panel does the same, for the same
  // keyboard-user reason. Only wired while nothing else (the row menu, the
  // confirm dialog) wants Escape for itself.
  useEffect(() => {
    if (!open || openMenuId || confirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, openMenuId, confirmId]);

  async function runAction(id: string, action: 'archive' | 'restore' | 'delete') {
    setBusyId(id);
    setRowError(null);
    try {
      if (action === 'archive') await archiveChat(id);
      else if (action === 'restore') await restoreChat(id);
      else await deleteChat(id);

      // Either action takes the chat out of Archived; archive/delete also
      // take it out of the main list, which the page's own poll (onChanged)
      // picks up.
      setArchivedChats((prev) => prev.filter((c) => c.id !== id));
      onChanged?.();
      // Restore never moves the chat off screen — only archive and delete do.
      if (action !== 'restore' && id === currentId) onCurrentRemoved?.();
    } catch (err) {
      const message =
        err instanceof StepUpRequiredError
          ? err.message
          : err instanceof Error
            ? err.message
            : `Could not ${action} that chat.`;
      setRowError({ id, message });
    } finally {
      setBusyId(null);
      setOpenMenuId(null);
      if (action === 'delete') setConfirmId(null);
    }
  }

  const actions: RowActions = {
    mode,
    busyId,
    openMenuId,
    errorId: rowError?.id ?? null,
    errorMessage: rowError?.message ?? null,
    onToggleMenu: (id) => setOpenMenuId((current) => (current === id ? null : id)),
    onArchive: (id) => void runAction(id, 'archive'),
    onRestore: (id) => void runAction(id, 'restore'),
    onRequestDelete: (id) => {
      setOpenMenuId(null);
      setConfirmId(id);
    },
  };

  const visibleMain = query ? filterChatTitles(chats, query) : chats;
  const visibleArchived = query ? filterChatTitles(archivedChats, query) : archivedChats;
  const visible = mode === 'main' ? visibleMain : visibleArchived;

  return (
    <>
      {/* Desktop — in-flow sidebar, left of the chat column. */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-void-700 h-full bg-void-900/60">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-void-800 shrink-0">
          <span className="text-xs font-semibold text-dim-300 uppercase tracking-wide">Chats</span>
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-1 text-[11px] text-dim-300 hover:text-accent transition-colors px-1.5 py-1 rounded"
          >
            <Plus size={12} /> New
          </button>
        </div>
        <ListControls mode={mode} onModeChange={setMode} query={query} onQueryChange={setQuery} />
        <ul className="flex-1 overflow-y-auto">
          <ListRows
            chats={visible}
            currentId={currentId}
            mode={mode}
            actions={actions}
            onOpen={onOpen}
            archivedLoading={archivedLoading}
            archivedError={archivedError}
          />
        </ul>
      </aside>

      {/* Phone — overlay drawer, closed by a tap outside or Escape. Portaled
          to <body> for the same reason the mobile work panel is: it has to
          rise above the tab bar's z-50 stacking context. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[110] md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
            <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs flex flex-col bg-void-900 border-r border-void-700">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-void-800 shrink-0">
                <span className="text-xs font-semibold text-dim-300 uppercase tracking-wide">Chats</span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close chat list"
                  className="p-1 text-dim-400 hover:text-dim-100 hover:bg-void-800 rounded transition-colors"
                >
                  <XIcon size={15} />
                </button>
              </div>
              <ListControls mode={mode} onModeChange={setMode} query={query} onQueryChange={setQuery} />
              <ul className="flex-1 overflow-y-auto">
                <ListRows
                  chats={visible}
                  currentId={currentId}
                  mode={mode}
                  actions={actions}
                  onOpen={(id) => {
                    onOpen(id);
                    onClose();
                  }}
                  archivedLoading={archivedLoading}
                  archivedError={archivedError}
                />
              </ul>
              <div className="px-3 py-2.5 border-t border-void-800 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onNew();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-dim-200
                             bg-void-800 border border-void-600 rounded-md py-2 hover:text-accent transition-colors"
                >
                  <Plus size={13} /> New chat
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Delete confirmation — above everything, including the phone drawer. */}
      {confirmId &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmId(null)} aria-hidden="true" />
            <div className="relative w-full max-w-sm rounded-md border border-void-700 bg-void-900 p-4 shadow-xl">
              <p className="text-sm text-dim-100">
                Delete from the app? The transcript stays on the server.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="px-3 py-1.5 text-xs text-dim-300 hover:text-dim-100 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyId === confirmId}
                  onClick={() => void runAction(confirmId, 'delete')}
                  className="px-3 py-1.5 text-xs text-red-300 border border-red-900/60 rounded
                             hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
