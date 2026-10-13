/**
 * WorkPanel — the collapsible module beside the chat thread.
 *
 * The main chat shows only SAM's final answer; everything that went into it
 * (thinking, tool calls, mid-turn commentary) streams into this panel. It is
 * the same component in two mounts — an in-flow side panel on desktop and an
 * overlay drawer on mobile — and the chat page decides which to render.
 */

'use client';

import { X, Square, Brain, Maximize2, Minimize2 } from 'lucide-react';

import type { ChatBlock } from '@/types/chat';
import { WorkBlocks } from './MessageBlocks';
import { ItemView } from '@/components/work/ItemView';
import { RecentItems } from '@/components/work/RecentItems';

export interface WorkPanelProps {
  /** Heading, e.g. "SAM · working". */
  title: string;
  running: boolean;
  /** Current phase label + elapsed seconds, shown while a turn is live. */
  phaseLabel: string;
  statusSeconds: string;
  stuck: boolean;
  blocks: ChatBlock[];
  onClose: () => void;
  onStop?: () => void;
  /** Which view is showing. Optional so today's callers keep working: defaults to 'work'. */
  view?: 'work' | 'items';
  onViewChange?: (view: 'work' | 'items') => void;
  openItem?: { path: string; from?: string } | null;
  onOpenItem?: (path: string, from?: string) => void;
  /** False when no message is picked: the Work tab is disabled. Defaults to true. */
  hasWork?: boolean;
  /** Full-screen state and toggle; the button shows only in Items with an open item. */
  fullScreen?: boolean;
  onToggleFull?: () => void;
}

export function WorkPanel({
  title,
  running,
  phaseLabel,
  statusSeconds,
  stuck,
  blocks,
  onClose,
  onStop,
  view = 'work',
  onViewChange,
  openItem = null,
  onOpenItem,
  hasWork = true,
  fullScreen = false,
  onToggleFull,
}: WorkPanelProps) {
  const tabs: Array<{ id: 'work' | 'items'; label: string; disabled: boolean }> = [
    { id: 'work', label: 'Work', disabled: !hasWork },
    { id: 'items', label: 'Items', disabled: false },
  ];
  return (
    <div className="flex flex-col h-full bg-void-900/80 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-void-700 shrink-0">
        <Brain size={14} className="text-accent shrink-0" />
        <span className="text-xs font-semibold text-dim-100 truncate">{title}</span>
        <span className="flex-1" />

        {running && (
          <span className="flex items-center gap-1.5 text-[10px] text-dim-400 shrink-0">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            {phaseLabel}
            {statusSeconds && <span className="font-mono text-dim-500">{statusSeconds}</span>}
          </span>
        )}
        {stuck && running && (
          <span className="text-[10px] text-amber-300 shrink-0">stuck</span>
        )}
        {running && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1 text-[10px] text-dim-400 hover:text-red-400 transition-colors shrink-0"
          >
            <Square size={9} /> stop
          </button>
        )}
        {view === 'items' && openItem && onToggleFull && (
          <button
            type="button"
            onClick={onToggleFull}
            className="flex items-center justify-center w-[44px] h-[44px] -my-2 text-dim-400 hover:text-dim-100 hover:bg-void-800 rounded transition-colors shrink-0"
            title={fullScreen ? 'Exit full screen' : 'Full screen'}
            aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-dim-400 hover:text-dim-100 hover:bg-void-800 rounded transition-colors shrink-0"
          title="Hide work"
          aria-label="Hide work"
        >
          <X size={15} />
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Panel view" className="flex border-b border-void-700 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            disabled={t.disabled}
            onClick={() => onViewChange?.(t.id)}
            className={`h-[44px] min-w-[44px] flex-1 text-xs transition-colors disabled:opacity-40 ${
              view === t.id
                ? 'text-dim-100 font-semibold border-b-2 border-accent'
                : 'text-dim-400 hover:text-dim-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {view === 'items' ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
          {openItem && <ItemView key={`${openItem.path}|${openItem.from ?? ''}`} path={openItem.path} from={openItem.from} onOpenItem={onOpenItem} fullScreen={fullScreen} />}
          <RecentItems onOpenItem={onOpenItem} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
          {blocks.length === 0 ? (
            <p className="text-xs text-dim-500">No work yet — SAM is getting started.</p>
          ) : (
            <WorkBlocks blocks={blocks} onOpenItem={onOpenItem} />
          )}
        </div>
      )}
    </div>
  );
}
