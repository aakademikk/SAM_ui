/**
 * WorkPanel — the collapsible module beside the chat thread.
 *
 * The main chat shows only SAM's final answer; everything that went into it
 * (thinking, tool calls, mid-turn commentary) streams into this panel. It is
 * the same component in two mounts — an in-flow side panel on desktop and an
 * overlay drawer on mobile — and the chat page decides which to render.
 */

'use client';

import { X, Square, Brain } from 'lucide-react';

import type { ChatBlock } from '@/types/chat';
import { WorkBlocks } from './MessageBlocks';

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
}: WorkPanelProps) {
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {blocks.length === 0 ? (
          <p className="text-xs text-dim-500">No work yet — SAM is getting started.</p>
        ) : (
          <WorkBlocks blocks={blocks} />
        )}
      </div>
    </div>
  );
}
