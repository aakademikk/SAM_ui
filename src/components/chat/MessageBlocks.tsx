/**
 * SAM — Block renderers for an agent turn.
 *
 * Everything here is built for a 6" screen first. Tool calls collapse to a
 * single line because an unfurled 200-line bash dump destroys scroll
 * position; expansion is always opt-in, and expanded content is height-capped
 * with its own scroll container so it can never push the page sideways.
 */

'use client';

import { useState } from 'react';
import {
  FileText, FilePen, FilePlus, Terminal as TerminalIcon, Search, Globe,
  Wrench, ChevronRight, Check, X, Loader2, Brain,
} from 'lucide-react';

import type { ChatBlock, ToolStatus } from '@/types/chat';

/* ========================================================================== */
/* Tool presentation                                                          */
/* ========================================================================== */

const TOOL_ICONS: Record<string, typeof FileText> = {
  Read: FileText,
  Edit: FilePen,
  Write: FilePlus,
  Bash: TerminalIcon,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
};

function baseName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** One-line "what did it actually touch" summary. */
function toolTarget(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');

  const filePath = str('file_path') || str('path') || str('notebook_path');
  if (filePath) return baseName(filePath);

  const command = str('command');
  if (command) return command.length > 48 ? `${command.slice(0, 48)}…` : command;

  const pattern = str('pattern') || str('query');
  if (pattern) return pattern.length > 40 ? `${pattern.slice(0, 40)}…` : pattern;

  const url = str('url');
  if (url) return url.replace(/^https?:\/\//, '').slice(0, 40);

  if (name === 'TodoWrite') return 'task list';
  return '';
}

function StatusDot({ status }: { status: ToolStatus }) {
  if (status === 'running') {
    return <Loader2 size={12} className="text-accent animate-spin shrink-0" />;
  }
  if (status === 'error') return <X size={12} className="text-red-400 shrink-0" />;
  return <Check size={12} className="text-emerald-400 shrink-0" />;
}

/* ========================================================================== */
/* Diff                                                                       */
/* ========================================================================== */

/**
 * Unified diff, deliberately not side-by-side — two columns on a phone are
 * unreadable. Shows the replaced lines then the new ones.
 */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const removed = oldText ? oldText.split('\n') : [];
  const added = newText ? newText.split('\n') : [];

  return (
    <div className="rounded border border-void-700 overflow-hidden">
      <div className="max-h-64 overflow-auto text-[11px] font-mono leading-relaxed">
        {removed.map((line, i) => (
          <div key={`r${i}`} className="flex bg-red-950/30">
            <span className="w-5 shrink-0 text-red-500/70 text-center select-none">−</span>
            <span className="text-red-300/90 whitespace-pre pr-2">{line || ' '}</span>
          </div>
        ))}
        {added.map((line, i) => (
          <div key={`a${i}`} className="flex bg-emerald-950/30">
            <span className="w-5 shrink-0 text-emerald-500/70 text-center select-none">+</span>
            <span className="text-emerald-300/90 whitespace-pre pr-2">{line || ' '}</span>
          </div>
        ))}
      </div>
      <div className="px-2 py-1 bg-void-900 border-t border-void-700 text-[10px] text-dim-300">
        −{removed.length} +{added.length}
      </div>
    </div>
  );
}

/** Height-capped monospace output that scrolls inside itself. */
function OutputBlock({ text }: { text: string }) {
  return (
    <pre
      className="max-h-64 overflow-auto rounded border border-void-700 bg-void-980/60
                 px-2 py-1.5 text-[11px] font-mono leading-relaxed text-dim-200
                 whitespace-pre-wrap break-words"
    >
      {text}
    </pre>
  );
}

/* ========================================================================== */
/* Tool card                                                                  */
/* ========================================================================== */

function ToolCard({ block }: { block: Extract<ChatBlock, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);

  const Icon = TOOL_ICONS[block.name] ?? Wrench;
  const target = toolTarget(block.name, block.input);

  const oldText = typeof block.input.old_string === 'string' ? block.input.old_string : '';
  const newText = typeof block.input.new_string === 'string' ? block.input.new_string : '';
  const content = typeof block.input.content === 'string' ? block.input.content : '';
  const isDiff = Boolean(oldText || newText);

  return (
    <div className="rounded-lg border border-void-700 bg-void-900/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left
                   hover:bg-void-800/60 transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          size={13}
          className={`text-dim-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Icon size={13} className="text-accent shrink-0" />
        <span className="text-xs font-medium text-dim-100 shrink-0">{block.name}</span>
        {target && (
          <>
            <span className="text-dim-500 text-xs shrink-0">·</span>
            <code className="text-xs text-dim-300 truncate">{target}</code>
          </>
        )}
        <span className="flex-1" />
        <StatusDot status={block.status} />
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {isDiff && <DiffView oldText={oldText} newText={newText} />}
          {!isDiff && content && <OutputBlock text={content} />}
          {!isDiff && !content && Object.keys(block.input).length > 0 && (
            <OutputBlock text={JSON.stringify(block.input, null, 2)} />
          )}
          {block.result !== undefined && block.result !== '' && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-dim-400">Result</p>
              <OutputBlock text={block.result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Thinking                                                                   */
/* ========================================================================== */

function ThinkingCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-void-700 bg-void-900/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left
                   hover:bg-void-800/60 transition-colors"
        aria-expanded={open}
      >
        <Brain size={13} className="text-accent shrink-0" />
        <span className="text-xs font-medium text-dim-200">
          {open ? 'Hide thinking' : 'Thought it through'}
        </span>
        <ChevronRight
          size={12}
          className={`text-dim-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <p
          className="px-2.5 pb-2.5 pl-5 border-l-2 border-accent/40 text-xs leading-relaxed
                     text-dim-200 whitespace-pre-wrap max-h-64 overflow-y-auto"
        >
          {text}
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/* List                                                                       */
/* ========================================================================== */

export function MessageBlocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'text':
            return (
              <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap text-dim-100">
                {block.text}
              </p>
            );
          case 'thinking':
            return <ThinkingCard key={i} text={block.text} />;
          case 'tool':
            return <ToolCard key={block.id || i} block={block} />;
          case 'error':
            return (
              <p
                key={i}
                className="text-xs text-red-400 bg-red-900/15 border border-red-700/25
                           rounded px-2 py-1.5"
              >
                {block.text}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/* ========================================================================== */
/* Answer / work split — the chat thread shows only the final answer; the     */
/* thinking and tool calls live in a separate collapsible work panel.         */
/* ========================================================================== */

/**
 * Split a turn's blocks into what belongs on the main chat (the answer) and
 * what belongs in the work panel. The answer is the LAST text block — the
 * parser merges consecutive text, so any earlier text blocks are the model
 * narrating its working mid-turn. Thinking and tool calls are always work.
 * Errors stay on the main chat: they are outcomes, not process.
 */
export function splitBlocks(blocks: ChatBlock[]): { answer: ChatBlock[]; work: ChatBlock[] } {
  let lastText = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === 'text') lastText = i;
  }

  const answer: ChatBlock[] = [];
  const work: ChatBlock[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === 'error') {
      answer.push(b);
    } else if (b.kind === 'text') {
      (i === lastText ? answer : work).push(b);
    } else {
      work.push(b); // thinking, tool
    }
  });
  return { answer, work };
}

/** The final-answer renderer for the main chat thread. */
export function AnswerBlocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.kind === 'text') {
          return (
            <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap text-dim-100">
              {block.text}
            </p>
          );
        }
        if (block.kind === 'error') {
          return (
            <p
              key={i}
              className="text-xs text-red-400 bg-red-900/15 border border-red-700/25
                         rounded px-2 py-1.5"
            >
              {block.text}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

/** The process renderer for the work panel — thinking, tool calls, and the
    mid-turn commentary the model types out between them. */
export function WorkBlocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'thinking':
            return <ThinkingCard key={i} text={block.text} />;
          case 'tool':
            return <ToolCard key={block.id || i} block={block} />;
          case 'text':
            return (
              <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap text-dim-300">
                {block.text}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
