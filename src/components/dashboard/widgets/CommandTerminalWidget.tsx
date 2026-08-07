'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Eraser, TerminalSquare } from 'lucide-react';

import type { TerminalStreamKind } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/store/dashboardStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import { Pill } from '@/components/ui/Indicators';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const LINE_STYLE: Record<TerminalStreamKind, string> = {
  stdin: 'text-slate-300',
  stdout: 'text-slate-400',
  stderr: 'text-alarm-300',
  system: 'text-[var(--sam-accent-2)]',
  sam: 'text-[var(--sam-accent)] italic',
};

/** Verbs offered by Tab completion — mirrors the server-side allow-list. */
const COMPLETIONS = [
  'help',
  'status',
  'ps',
  'ps agents',
  'top',
  'df',
  'free',
  'uptime',
  'whoami',
  'ls',
  'clear',
  'git status',
  'docker ps',
  'docker restart ',
  'docker logs ',
  'docker stats',
  'n8n list',
  'n8n run ',
  'n8n status',
  'agent list',
  'agent spawn ',
  'agent kill ',
  'agent boost ',
  'vault stats',
  'vault reindex',
  'vault reindex --priority',
  'vault query ',
  'python ',
];

export function CommandTerminalWidget({
  size,
  index,
  dragHandleProps,
  isDragging,
  isOverlay,
}: WidgetProps) {
  const terminal = useDashboardStore((s) => s.terminal);
  const runCommand = useDashboardStore((s) => s.runCommand);
  const clearTerminal = useDashboardStore((s) => s.clearTerminal);

  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [ghost, setGhost] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const profile = sizeProfile(size);
  // The terminal never waits on a fetch — it is interactive from first paint.
  const status = resolveStatus({
    data: terminal.lines,
    status: 'ready',
    error: null,
    updatedAt: null,
    failures: 0,
  });

  /* --- Autoscroll --------------------------------------------------------- */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [terminal.lines.length, terminal.running]);

  /* --- Inline completion hint --------------------------------------------- */
  useEffect(() => {
    if (!input.trim()) {
      setGhost('');
      return;
    }
    const match = COMPLETIONS.find((c) => c.startsWith(input) && c !== input);
    setGhost(match ? match.slice(input.length) : '');
  }, [input]);

  const submit = () => {
    const command = input.trim();
    if (!command || terminal.running) return;
    setInput('');
    setGhost('');
    setHistoryIndex(-1);
    void runCommand(command);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'Tab' && ghost) {
      event.preventDefault();
      setInput(input + ghost);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, terminal.history.length - 1);
      if (next >= 0 && terminal.history[next] !== undefined) {
        setHistoryIndex(next);
        setInput(terminal.history[next]);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = historyIndex - 1;
      if (next < 0) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(terminal.history[next] ?? '');
      }
      return;
    }

    // Ctrl+C clears the current line rather than the scrollback.
    if (event.key === 'c' && event.ctrlKey) {
      event.preventDefault();
      setInput('');
      setGhost('');
    }
  };

  const lines = profile.compact ? terminal.lines.slice(-6) : terminal.lines;

  return (
    <WidgetFrame
      id="command-terminal"
      title="Command Terminal"
      subtitle={profile.compact ? undefined : terminal.cwd}
      icon={<TerminalSquare size={13} />}
      tone="success"
      size={size}
      status={status}
      updatedAt={undefined}
      index={index}
      skeletonVariant="terminal"
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        <>
          {terminal.running && <Pill tone="warning">running</Pill>}
          <button
            type="button"
            onClick={clearTerminal}
            aria-label="Clear terminal scrollback"
            title="Clear"
            className="rounded-[3px] p-1 text-void-300 opacity-0 transition hover:bg-white/5 hover:text-slate-300 focus-visible:opacity-100 group-hover/widget:opacity-100"
          >
            <Eraser size={12} />
          </button>
        </>
      }
    >
      <div
        className="scanlines flex h-full min-h-0 flex-col bg-black/45"
        onClick={() => inputRef.current?.focus()}
      >
        {/* Scrollback */}
        <div
          ref={scrollRef}
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.55]"
        >
          {lines.map((line) => (
            <div
              key={line.id}
              className={cn('break-words whitespace-pre-wrap', LINE_STYLE[line.kind])}
            >
              {line.kind === 'sam' && <span className="mr-1 not-italic opacity-70">SAM:</span>}
              {line.text}
            </div>
          ))}

          {terminal.running && (
            <div className="flex items-center gap-1.5 text-[var(--sam-accent-2)]">
              <span className="inline-block size-1.5 animate-[sam-breathe_1.1s_ease-in-out_infinite] rounded-full bg-current" />
              <span className="opacity-70">executing…</span>
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="flex shrink-0 items-center gap-1.5 border-t border-toxic-400/15 bg-black/55 px-3 py-2 font-mono text-[11px]">
          <span className="shrink-0 text-toxic-400/80">{terminal.cwd}</span>
          <ChevronRight size={11} className="-mx-0.5 shrink-0 text-toxic-400/60" />

          <div className="relative min-w-0 flex-1">
            {/* Ghost completion sits behind the caret. */}
            <div className="pointer-events-none absolute inset-0 truncate whitespace-pre text-slate-600">
              <span className="invisible">{input}</span>
              {ghost}
            </div>
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={terminal.running}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="Terminal command input"
              placeholder={terminal.running ? '' : 'type a command…'}
              className="relative w-full bg-transparent text-slate-100 caret-toxic-400 placeholder:text-slate-700 focus:outline-none disabled:opacity-50"
            />
          </div>

          {ghost && (
            <kbd className="hidden shrink-0 rounded-[2px] border border-void-400 px-1 py-px text-[8.5px] text-slate-600 sm:inline">
              TAB
            </kbd>
          )}
        </div>
      </div>
    </WidgetFrame>
  );
}
