/**
 * /chat — SAM, running the real agent.
 *
 * Each message starts a server-side job running the Claude Code CLI, so chat
 * has the same file/bash/tool reach as the desktop rather than being a
 * separate, weaker assistant. Output streams over the job SSE endpoint and is
 * reduced into typed blocks for rendering.
 *
 * Voice deliberately speaks the final answer only — tool calls and thinking
 * are shown, never narrated.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Cpu, Volume2, VolumeX, Zap, Sparkles, Lock, Square } from 'lucide-react';

import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { MessageBlocks } from '@/components/chat/MessageBlocks';
import { readMessage as readCrossTab } from '@/lib/crossTab';
import { jobsService } from '@/lib/jobsService';
import { authService } from '@/lib/authService';
import { startAgentTurn, StepUpRequiredError } from '@/lib/chatAgentService';
import { AgentStreamParser, type AgentPhase } from '@/lib/agentStream';
import { computeCost, formatCost, formatTokens } from '@/lib/costing';
import { spokenText, type ChatMessage, type TierId, type TierInfo } from '@/types/chat';
import { speakChunked, primeSpeech, isSpeechBlocked, type SpeechHandle } from '@/lib/speech';
import { setSamActivity } from '@/lib/samActivity';

const MESSAGES_KEY = 'sam-agent-messages';
const SESSION_KEY = 'sam-agent-session';
const TIER_KEY = 'sam-agent-tier';
const ACTIVE_KEY = 'sam-agent-active';
const PENDING_KEY = 'sam-agent-pending';
const MAX_STORED = 40;
/** Dropped connections are retried before a turn is declared lost. */
const MAX_RECONNECTS = 5;

/**
 * A turn in flight. Persisted so that leaving the tab — which unmounts this
 * page and tears down the SSE connection — does not lose the run. The job
 * itself keeps going server-side; on return we reattach and replay it.
 */
interface ActiveRun {
  jobId: string;
  assistantId: string;
  tier: TierInfo;
}

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch { /* corrupted */ }
  return [];
}

const PHASE_LABEL: Record<AgentPhase, string> = {
  starting: 'Starting session',
  thinking: 'Thinking',
  working: 'Working',
  streaming: 'Replying',
  done: '',
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [tier, setTier] = useState<TierId>('fast');
  const [sessionCost, setSessionCost] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const speechRef = useRef<SpeechHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<{ close(): void } | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachRef = useRef<((run: ActiveRun) => void) | null>(null);

  /* ── Persistence ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const stored = localStorage.getItem(TIER_KEY);
    if (stored === 'fast' || stored === 'max') setTier(stored);
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
    } catch { /* quota */ }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  useEffect(() => () => {
    streamRef.current?.close();
    speechRef.current?.stop();
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    setSamActivity('idle');
  }, []);

  /* ── Elapsed timer — honest progress across the cold start ───────────── */

  // The ambient visualiser mirrors what SAM is doing on this screen.
  useEffect(() => {
    if (running) setSamActivity(phase === 'streaming' ? 'speaking' : 'thinking');
    else if (!speaking) setSamActivity('idle');
  }, [running, phase, speaking]);

  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  /* ── Text-to-speech — final answers only ─────────────────────────────── */

  /**
   * Speech is synthesised and played a sentence-group at a time, so audio
   * starts after the first short chunk rather than after the whole answer.
   */
  const speak = useCallback((id: string, text: string) => {
    speechRef.current?.stop();
    speechRef.current = null;

    // Tapping the speaker on the message already playing means "stop".
    if (speaking === id) {
      setSpeaking(null);
      return;
    }
    if (!text.trim()) return;

    setSpeaking(id);
    const handle = speakChunked(text, {
      voice: parseInt(localStorage.getItem('sam-tts-voice') ?? '21', 10),
      onState: (isSpeaking) => setSamActivity(isSpeaking ? 'speaking' : 'idle'),
    });
    speechRef.current = handle;

    void handle.done.then(() => {
      setAudioBlocked(isSpeechBlocked());
      setSpeaking((current) => (current === id ? null : current));
      if (speechRef.current === handle) speechRef.current = null;
    });
  }, [speaking]);

  /* ── Attach to a running turn ────────────────────────────────────────── */

  /**
   * Open the job stream and rebuild the assistant message from it.
   *
   * Always replays from sequence 0 with a fresh parser, so this doubles as the
   * reconnect path: whether the turn started a moment ago or while the tab was
   * backgrounded, the resulting blocks are identical.
   */
  const attachToRun = useCallback((run: ActiveRun) => {
    streamRef.current?.close();
    activeJobRef.current = run.jobId;

    const parser = new AgentStreamParser();
    setRunning(true);
    setPhase('starting');
    setError(null);

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === run.assistantId ? fn(m) : m)));

    const finalise = (exitCode: number | null, lost: boolean) => {
      const state = parser.finish(exitCode);
      const cost = computeCost(run.tier, state.usage, state.reportedCostUsd);

      if (state.sessionId) localStorage.setItem(SESSION_KEY, state.sessionId);
      localStorage.removeItem(ACTIVE_KEY);
      if (cost) setSessionCost((c) => c + cost.usd);

      // Spoken text comes from the parser's final blocks directly, NOT from a
      // value written inside the setMessages updater below — React defers that
      // updater to the next render, so anything assigned in it would still be
      // unset here and auto-speak would silently never fire.
      const spoken = lost
        ? ''
        : spokenText({ id: run.assistantId, role: 'assistant', blocks: state.blocks, done: true });
      patch((m) => ({
        ...m,
        blocks: lost
          ? [...state.blocks, { kind: 'error' as const, text: 'Lost connection to this run.' }]
          : [...state.blocks],
        sessionId: state.sessionId,
        usage: state.usage,
        cost,
        durationMs: state.durationMs,
        done: true,
      }));

      setRunning(false);
      setPhase('done');
      activeJobRef.current = null;
      if (!muted && !lost && spoken) void speak(run.assistantId, spoken);
    };

    streamRef.current = jobsService.stream(run.jobId, (event) => {
      if (event.type === 'output') {
        retriesRef.current = 0;
        const state = parser.push(event.text);
        setPhase(state.phase);
        // Persist the session id the moment it appears, not at the end — a
        // turn interrupted mid-flight must still be resumable next time.
        if (state.sessionId) localStorage.setItem(SESSION_KEY, state.sessionId);
        patch((m) => ({ ...m, blocks: [...state.blocks] }));
      } else if (event.type === 'closed') {
        // 'lost' means the connection dropped, not that the job ended — which
        // is exactly what a phone does when the app is backgrounded. The job
        // is still running server-side, so reconnect rather than give up.
        if (event.status === 'lost' && retriesRef.current < MAX_RECONNECTS) {
          retriesRef.current += 1;
          const delay = 600 * retriesRef.current;
          reconnectRef.current = setTimeout(() => attachRef.current?.(run), delay);
          return;
        }
        finalise(event.exitCode, event.status === 'lost');
      }
    });
  }, [muted, speak]);

  // Lets the stream callback re-enter attachToRun without a circular dep.
  attachRef.current = attachToRun;

  /* ── Reconnect when the app comes back to the foreground ─────────────── */

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;

      const raw = localStorage.getItem(ACTIVE_KEY);
      if (!raw) return;

      try {
        const run = JSON.parse(raw) as ActiveRun;
        const pending = loadMessages().find((m) => m.id === run.assistantId);
        if (!pending || pending.done) return;
        retriesRef.current = 0;
        attachRef.current?.(run);
      } catch {
        localStorage.removeItem(ACTIVE_KEY);
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /* ── Reattach after the tab was left ─────────────────────────────────── */

  useEffect(() => {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return;

    let run: ActiveRun;
    try {
      run = JSON.parse(raw) as ActiveRun;
    } catch {
      localStorage.removeItem(ACTIVE_KEY);
      return;
    }

    // Only reattach if that message is still unfinished.
    const pending = loadMessages().find((m) => m.id === run.assistantId);
    if (!run.jobId || !pending || pending.done) {
      localStorage.removeItem(ACTIVE_KEY);
      return;
    }

    attachToRun(run);
    // Mount only — attachToRun is stable enough for this and re-running it
    // here would reopen the stream on every speak() state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Recover a message that failed on biometric unlock ────────────────── */

  useEffect(() => {
    const pending = localStorage.getItem(PENDING_KEY);
    if (!pending) return;
    void authService.checkSession().then((s) => {
      if (!s.authenticated) {
        localStorage.removeItem(PENDING_KEY);
        return;
      }
      if (s.stepUp) {
        // A biometric happened elsewhere since the failure — the message can
        // go out now without another prompt.
        localStorage.removeItem(PENDING_KEY);
        void send(pending);
      } else {
        setNeedsStepUp(true);
        setError('Biometric unlock required before SAM can run anything.');
      }
    });
    // Mount only — send's identity changes with running/tier; re-running this
    // on those changes would fire the pending message repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Send ────────────────────────────────────────────────────────────── */

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || running) return;

    // A fresh send supersedes any message waiting on a biometric unlock.
    localStorage.removeItem(PENDING_KEY);

    // Unlock audio while we still have user activation. By the time the
    // answer lands, seconds later, the gesture has expired and the browser
    // would refuse to play anything.
    primeSpeech();

    const stamp = Date.now();
    const assistantId = `a_${stamp}`;

    setMessages((prev) => [
      ...prev,
      { id: `u_${stamp}`, role: 'user', blocks: [{ kind: 'text', text: message }], done: true },
      { id: assistantId, role: 'assistant', blocks: [], done: false, tier },
    ]);
    setInput('');
    setError(null);
    setRunning(true);
    setPhase('starting');

    try {
      const resumeSessionId = localStorage.getItem(SESSION_KEY) ?? undefined;
      const started = await startAgentTurn({ message, tier, resumeSessionId });

      const run: ActiveRun = {
        jobId: started.jobId,
        assistantId,
        tier: started.tier,
      };
      // Recorded before streaming starts, so a tab switch a second later can
      // still find its way back to this run.
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(run));

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, jobId: started.jobId } : m)),
      );

      attachToRun(run);
    } catch (err) {
      if (err instanceof StepUpRequiredError) {
        // Hold the message so a successful unlock can resend it without a retype.
        localStorage.setItem(PENDING_KEY, message);
        setNeedsStepUp(true);
        setError('Biometric unlock required before SAM can run anything.');
      } else {
        setError(err instanceof Error ? err.message : 'Chat failed');
      }
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      setRunning(false);
    }
  }, [running, tier, attachToRun]);

  /* ── Stop ────────────────────────────────────────────────────────────── */

  const stop = useCallback(async () => {
    const jobId = activeJobRef.current;
    if (!jobId) return;
    try { await jobsService.kill(jobId); } catch { /* already gone */ }
  }, []);

  /* ── Messages relayed from the Terminal tab ──────────────────────────── */

  useEffect(() => {
    const check = () => {
      const msg = readCrossTab('chat');
      if (msg) setInput(msg);
    };
    check();
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const toggleTier = () => {
    const next: TierId = tier === 'fast' ? 'max' : 'fast';
    setTier(next);
    localStorage.setItem(TIER_KEY, next);
  };

  const newConversation = () => {
    streamRef.current?.close();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(MESSAGES_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(PENDING_KEY);
    setMessages([]);
    setSessionCost(0);
    setError(null);
    setRunning(false);
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:min-h-screen">
      {/* Status bar — tier is a capability and a cost, so it stays visible */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-void-800 shrink-0">
        <button
          type="button"
          onClick={toggleTier}
          disabled={running}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border
                      transition-colors disabled:opacity-40 ${
            tier === 'fast'
              ? 'text-accent bg-accent/10 border-accent/30'
              : 'text-amber-300 bg-amber-900/20 border-amber-700/40'
          }`}
          title={
            tier === 'fast'
              ? 'Fast tier — cheap, separate quota, sends context to DeepSeek. Tap for Max.'
              : 'Max tier — Claude, uses your subscription quota. Tap for Fast.'
          }
        >
          {tier === 'fast' ? <Zap size={12} /> : <Sparkles size={12} />}
          {tier === 'fast' ? 'Fast' : 'Max'}
        </button>

        {sessionCost > 0 && (
          <span className="text-[11px] text-dim-400 font-mono" title="Session spend">
            {formatCost(sessionCost)}
          </span>
        )}

        <span className="flex-1" />

        {messages.length > 0 && (
          <button
            type="button"
            onClick={newConversation}
            className="text-[11px] text-dim-400 hover:text-dim-200 transition-colors px-1.5"
          >
            New
          </button>
        )}

        <button
          type="button"
          onClick={() => setMuted(!muted)}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
            muted
              ? 'text-red-400 bg-red-900/20 border border-red-700/30'
              : 'text-dim-300 hover:text-dim-100'
          }`}
          title={muted ? 'Unmute SAM' : 'Mute SAM'}
        >
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-20">
            <Cpu size={32} className="text-accent/40" />
            <h2 className="text-lg font-bold text-dim-200">SAM</h2>
            <p className="text-sm text-dim-400 max-w-xs">
              Full access — reads and writes the vault, runs commands, uses tools.
              Same brain as the desktop.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`rounded-lg px-3 py-2.5 ${
                msg.role === 'user'
                  ? 'max-w-[85%] md:max-w-[70%] bg-accent/15 border border-accent/30 text-void-100'
                  : 'max-w-[92%] md:max-w-[80%] bg-void-800/70 border border-void-700 w-full'
              }`}
            >
              <MessageBlocks blocks={msg.blocks} />

              {msg.role === 'assistant' && msg.done && (
                <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-void-700/60">
                  <button
                    type="button"
                    onClick={() => { primeSpeech(); speak(msg.id, spokenText(msg)); }}
                    className="text-dim-300 hover:text-accent transition-colors"
                    title={speaking === msg.id ? 'Stop' : 'Replay'}
                  >
                    {speaking === msg.id ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </button>
                  <span className="flex-1" />
                  {msg.usage && (
                    <span className="text-[10px] text-dim-500 font-mono">
                      {formatTokens(msg.usage.inputTokens + msg.usage.cacheReadTokens)} in
                    </span>
                  )}
                  {msg.cost && (
                    <span
                      className="text-[10px] text-dim-500 font-mono"
                      title={msg.cost.basis === 'computed'
                        ? 'Computed from token counts'
                        : 'Reported by the CLI'}
                    >
                      {formatCost(msg.cost.usd)}
                    </span>
                  )}
                  {msg.durationMs !== undefined && (
                    <span className="text-[10px] text-dim-500 font-mono">
                      {(msg.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Live progress — the cold start is real, so show what it is doing */}
        {running && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 text-xs text-dim-400 px-3 py-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span>{PHASE_LABEL[phase] || 'Working'}…</span>
              {elapsed > 1 && <span className="font-mono text-dim-500">{elapsed}s</span>}
              <button
                type="button"
                onClick={stop}
                className="ml-1 flex items-center gap-1 text-[10px] text-dim-400
                           hover:text-red-400 transition-colors"
              >
                <Square size={9} /> stop
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-red-400 bg-red-900/20 px-3 py-1.5 rounded-full">
              {error}
            </span>
            {needsStepUp && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await authService.stepUp();
                    setNeedsStepUp(false);
                    setError(null);
                    const pending = localStorage.getItem(PENDING_KEY);
                    localStorage.removeItem(PENDING_KEY);
                    if (pending) void send(pending);
                  } catch { /* cancelled */ }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 border
                           border-accent/40 rounded-lg text-accent text-xs font-medium
                           hover:bg-accent/30 transition-colors"
              >
                <Lock size={12} /> Unlock
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div
        className="shrink-0 border-t border-void-700 bg-void-900/80 backdrop-blur-md
                   px-3 py-2.5 md:px-6 md:py-3 space-y-2
                   pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
      >
        {audioBlocked && !muted && (
          <p className="text-center text-[11px] text-dim-400">
            Your browser blocked autoplay — tap the speaker on a reply to hear it.
          </p>
        )}

        <div className="flex justify-center">
          <VoiceRecordButton
            onTranscribe={(text) => {
              primeSpeech();
              void send(text);
            }}
          />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
          className="flex items-center gap-2 max-w-3xl mx-auto"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={running ? 'SAM is working…' : 'Type a message…'}
            disabled={running}
            className="flex-1 bg-void-800 border border-void-600 rounded-full px-4 py-2.5
                       text-void-100 text-sm placeholder:text-dim-500
                       focus:border-accent focus:outline-none disabled:opacity-50"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!input.trim() || running}
            className="p-2.5 bg-accent/20 border border-accent/40 rounded-full
                       text-accent hover:bg-accent/30 disabled:opacity-30
                       transition-colors shrink-0"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
