'use client';

/**
 * SAM — Enhanced AI Chat Panel.
 *
 * Omnipresent. Docked to the right on desktop, a full-height sheet on mobile.
 * The eye sits at the top and reacts to store mood, so SAM is visibly reacting
 * to the estate even when nobody is typing at him.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, MessageSquareOff, PanelRightClose, Sparkles, Terminal } from 'lucide-react';

import type { ChatMessage } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { greeting } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { SamEye } from '@/components/chat/SamEye';
import { Pill } from '@/components/ui/Indicators';
import { useMounted } from '@/hooks/useLiveClock';

const SUGGESTIONS = [
  'What is actually broken right now?',
  'Roast my plan to ship the portal on Friday',
  'Why is the agent fleet blocked?',
  '/exec docker ps',
];

/* ========================================================================== */

function MessageBubble({ message, index }: { message: ChatMessage; index: number }) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.02, 0.1), ease: [0.16, 1, 0.3, 1] }}
      className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}
    >
      <span className="label px-1">{isUser ? 'you' : 'sam'}</span>

      <div
        className={cn(
          'max-w-[92%] rounded-[5px] px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap',
          isUser
            ? 'bg-void-600/70 text-slate-200 ring-1 ring-void-400/60'
            : 'border-l-2 border-[var(--sam-accent)] bg-black/40 text-slate-300',
          message.severity === 'critical' && !isUser && 'border-alarm-400',
        )}
      >
        {message.content}
        {message.streaming && (
          <span className="ml-0.5 inline-block h-[13px] w-[6px] translate-y-[2px] animate-[sam-caret_1.05s_steps(1,end)_infinite] bg-[var(--sam-accent-2)]" />
        )}
      </div>

      {message.actions && message.actions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {message.actions.map((action) => (
            <Pill
              key={action.label}
              tone={action.status === 'ok' ? 'success' : action.status === 'failed' ? 'critical' : 'warning'}
            >
              {action.label}
            </Pill>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ========================================================================== */

export function AIChatPanel() {
  const messages = useDashboardStore((s) => s.chat.messages);
  const sending = useDashboardStore((s) => s.chat.sending);
  const chatError = useDashboardStore((s) => s.chat.error);
  const mood = useDashboardStore((s) => s.mood);
  const sendChat = useDashboardStore((s) => s.sendChat);
  const resetChat = useDashboardStore((s) => s.resetChat);

  const chatOpen = useUserPreferencesStore((s) => s.chatOpen);
  const chatWidth = useUserPreferencesStore((s) => s.chatWidth);
  const setChatOpen = useUserPreferencesStore((s) => s.setChatOpen);
  const setChatWidth = useUserPreferencesStore((s) => s.setChatWidth);
  const operatorName = useUserPreferencesStore((s) => s.operatorName);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);
  const hydrated = useUserPreferencesStore((s) => s.hydrated);

  const [draft, setDraft] = useState('');
  const [resizing, setResizing] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useMounted();

  /* --- Autoscroll --------------------------------------------------------- */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* --- Auto-grow textarea -------------------------------------------------- */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [draft]);

  /* --- Global focus shortcut ---------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setChatOpen(true);
        // The panel may still be animating in when this fires.
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setChatOpen]);

  /* --- Resize ------------------------------------------------------------- */
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizing(true);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      setChatWidth(window.innerWidth - moveEvent.clientX);
    };
    const onUp = () => {
      setResizing(false);
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const send = (text?: string) => {
    const value = (text ?? draft).trim();
    if (!value || sending) return;
    setDraft('');
    void sendChat(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const openingLine = useMemo(
    () => greeting(new Date().getUTCHours(), operatorName, sarcasm),
    [operatorName, sarcasm],
  );

  // Width only applies once preferences have rehydrated; before that the
  // server-rendered default would jump.
  const width = hydrated ? chatWidth : 396;

  return (
    <>
      {/* Collapsed rail */}
      <AnimatePresence>
        {!chatOpen && mounted && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            onClick={() => setChatOpen(true)}
            aria-label="Open SAM chat panel"
            className="glass-strong fixed top-1/2 right-4 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-md px-2.5 py-4 transition-shadow hover:shadow-[0_0_40px_-8px_var(--sam-accent)]"
          >
            <SamEye mood={mood} size={44} />
            <span
              className="font-mono text-[9px] tracking-[0.24em] text-slate-400 uppercase"
              style={{ writingMode: 'vertical-rl' }}
            >
              SAM
            </span>
            <kbd className="rounded-[2px] border border-void-400 px-1 py-px font-mono text-[8px] text-slate-600">
              ⌘K
            </kbd>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {chatOpen && (
          <motion.aside
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            style={{ width: mounted ? undefined : width }}
            className={cn(
              'glass-strong fixed inset-y-0 right-0 z-40 flex flex-col border-l border-[var(--sam-accent)]/22',
              'w-full sm:w-[var(--chat-w)]',
            )}
            // Custom property keeps the responsive class list static.
            ref={(node) => {
              node?.style.setProperty('--chat-w', `${width}px`);
            }}
            aria-label="SAM chat panel"
          >
            {/* Resize handle */}
            <div
              onPointerDown={startResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat panel"
              className={cn(
                'absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize sm:block',
                resizing && 'bg-[var(--sam-accent)]/25',
              )}
            >
              <div className="absolute inset-y-0 left-1 w-px bg-[var(--sam-accent)]/0 transition-colors hover:bg-[var(--sam-accent)]/50" />
            </div>

            {/* ---- Header ---- */}
            <header className="relative flex shrink-0 flex-col items-center gap-3 border-b border-void-500/50 px-4 pt-5 pb-4">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, var(--sam-accent), var(--sam-accent-2), transparent)',
                }}
              />

              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Collapse chat panel"
                className="absolute top-3 right-3 rounded-[3px] p-1 text-void-300 transition hover:bg-white/6 hover:text-slate-300"
              >
                <PanelRightClose size={14} />
              </button>

              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={resetChat}
                  aria-label="Clear conversation"
                  title="Clear conversation"
                  className="absolute top-3 left-3 rounded-[3px] p-1 text-void-300 transition hover:bg-white/6 hover:text-slate-300"
                >
                  <MessageSquareOff size={13} />
                </button>
              )}

              <SamEye mood={mood} size={116} showLabel />

              <div className="text-center">
                <h2 className="neon font-mono text-[13px] font-semibold tracking-[0.3em] text-slate-100 uppercase">
                  S A M
                </h2>
                <p className="mt-0.5 font-mono text-[8.5px] tracking-[0.16em] text-slate-600 uppercase">
                  Seriously Awesome Machine
                </p>
              </div>
            </header>

            {/* ---- Messages ---- */}
            <div ref={scrollRef} className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4">
              {/* Opening line is generated, never stored — it re-greets on reload. */}
              <div className="rounded-[5px] border-l-2 border-[var(--sam-accent)] bg-black/40 px-3 py-2 text-[12px] leading-relaxed text-slate-300">
                {openingLine}
              </div>

              {messages.map((message, index) => (
                <MessageBubble key={message.id} message={message} index={index} />
              ))}

              {messages.length === 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <span className="label mb-0.5">try</span>
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="group flex items-center gap-2 rounded-[4px] border border-void-400/50 bg-void-700/40 px-2.5 py-1.5 text-left text-[11.5px] text-slate-400 transition-colors hover:border-[var(--sam-accent)]/45 hover:bg-void-600/50 hover:text-slate-200"
                    >
                      {suggestion.startsWith('/') ? (
                        <Terminal size={11} className="shrink-0 text-toxic-400/70" />
                      ) : (
                        <Sparkles size={11} className="shrink-0 text-[var(--sam-accent)]/70" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{suggestion}</span>
                    </button>
                  ))}
                </div>
              )}

              {chatError && (
                <p className="rounded-[4px] border border-alarm-400/30 bg-alarm-500/10 px-2.5 py-1.5 text-[11px] text-alarm-300">
                  {chatError}
                </p>
              )}
            </div>

            {/* ---- Composer ---- */}
            <div className="shrink-0 border-t border-void-500/50 p-3">
              <div
                className={cn(
                  'glass-sunken relative flex items-end gap-2 rounded-[5px] border px-2.5 py-2 transition-colors',
                  sending ? 'border-[var(--sam-accent-2)]/40' : 'border-void-400/60 focus-within:border-[var(--sam-accent)]/50',
                )}
              >
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  maxLength={4000}
                  disabled={sending}
                  placeholder={sending ? 'SAM is composing…' : 'Ask, argue, or /exec a command…'}
                  aria-label="Message SAM"
                  className="scrollbar-thin max-h-[148px] min-w-0 flex-1 resize-none bg-transparent text-[12px] leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
                />

                <button
                  type="button"
                  onClick={() => send()}
                  disabled={!draft.trim() || sending}
                  aria-label="Send message"
                  className="mb-0.5 shrink-0 rounded-[3px] border border-[var(--sam-accent)]/40 bg-[var(--sam-accent)]/15 p-1.5 text-[var(--sam-accent)] transition-colors hover:bg-[var(--sam-accent)]/28 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <CornerDownLeft size={13} />
                </button>
              </div>

              <div className="mt-1.5 flex items-center justify-between px-1">
                <span className="font-mono text-[8.5px] tracking-wider text-slate-700 uppercase">
                  enter to send · shift+enter newline
                </span>
                <span className="font-mono text-[8.5px] tracking-wider text-slate-700 uppercase">
                  /exec runs commands
                </span>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
