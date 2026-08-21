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
 *
 * The main thread renders only the final answer; thinking, tool calls and the
 * mid-turn commentary stream into a collapsible work panel (side panel on
 * desktop, overlay drawer on mobile) so the chat stays clean.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, Cpu, Volume2, VolumeX, Zap, Sparkles, Lock, Square, Wrench } from 'lucide-react';

import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { HandsFreeMic } from '@/components/voice/HandsFreeMic';
import { desktopWakeSeq } from '@/lib/desktopBridge';
import { splitBlocks, AnswerBlocks } from '@/components/chat/MessageBlocks';
import { WorkPanel } from '@/components/chat/WorkPanel';
import { readMessage as readCrossTab } from '@/lib/crossTab';
import { jobsService } from '@/lib/jobsService';
import { authService } from '@/lib/authService';
import { startAgentTurn, StepUpRequiredError } from '@/lib/chatAgentService';
import { AgentStreamParser, type AgentPhase } from '@/lib/agentStream';
import { computeCost, formatCost, formatTokens } from '@/lib/costing';
import { spokenText, type ChatMessage, type TierId, type TierInfo } from '@/types/chat';
import { speakChunked, primeSpeech, isSpeechBlocked, type SpeechHandle } from '@/lib/speech';
import { setSamActivity } from '@/lib/samActivity';
import { configureOsBridge } from '@/lib/osBridge';
import { tryOsIntent } from '@/lib/osIntentRunner';

const MESSAGES_KEY = 'sam-agent-messages';
const SESSION_KEY = 'sam-agent-session';
const TIER_KEY = 'sam-agent-tier';
const ACTIVE_KEY = 'sam-agent-active';
const PENDING_KEY = 'sam-agent-pending';
const MAX_STORED = 40;
/** Dropped connections are retried before a turn is declared lost. */
const MAX_RECONNECTS = 5;
/** A fast-tier turn stuck in pure thinking (no text/tool output) for this long is a runaway. */
const STUCK_WARN_MS = 90_000;
/** Auto-kill a turn that has produced nothing for this long. */
const STUCK_KILL_MS = 150_000;

/**
 * Immediate ack spoken the moment a turn starts, covering the agent boot +
 * context load + thinking gap so the chat never sits silent after a message.
 * Rotates so it never becomes a catchphrase. Mirrors the voice-line kiosk
 * list in `voice-line/server.py` — keep the two in step.
 */
const ACK_PHRASES = [
  'On it G',
  'Looking into that now',
  'On it',
  'Give me a sec G',
  'Already on it',
];
let ackIdx = 0;
function nextAck(): string {
  const phrase = ACK_PHRASES[ackIdx % ACK_PHRASES.length];
  ackIdx += 1;
  return phrase;
}

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

/** Server-side phase names (stream route) that the parser cannot produce —
    they name the silent gaps before any model output. */
const SERVER_PHASE_LABEL: Record<string, string> = {
  spawn: 'Booting SAM',
  boot: 'Starting',
  context: 'Loading context',
  model: 'Replying',
  done: '',
};

/** The work panel is in-flow on desktop and an overlay on phones; only a
    fresh turn auto-opens it, and only on a screen that has room for both. */
const isNarrowScreen = () => window.matchMedia('(max-width: 767px)').matches;

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>('starting');
  /** Latest server-side phase ping, with ms since process start. */
  const [serverPhase, setServerPhase] = useState<{ phase: string; ms: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** True while a turn is running but producing no real output — likely a runaway. */
  const [stuck, setStuck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);
  /** Opened by the Android wake word rather than by tapping the icon. */
  const [wokenByVoice, setWokenByVoice] = useState(false);
  /**
   * Hands-free session — survives across turns until cancelled. Wake sets it,
   * cancel clears it, the hold-to-record button is the fallback when the mic
   * cannot be acquired without a tap.
   */
  const [handsFree, setHandsFree] = useState(false);
  /** Non-null when hands-free fell back to the hold button, holding why. */
  const [handsFreeFailed, setHandsFreeFailed] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [tier, setTier] = useState<TierId>('fast');
  const [sessionCost, setSessionCost] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  /** Mobile layout — drives which work-panel mount renders. */
  const [isNarrow, setIsNarrow] = useState(false);
  /** Work panel — which assistant message's thinking/tool calls are shown, and
      whether the panel is open. The main thread renders answers only. */
  const [workOpen, setWorkOpen] = useState(false);
  const [workMessageId, setWorkMessageId] = useState<string | null>(null);

  const speechRef = useRef<SpeechHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Root of the chat column — carries --kb (keyboard overlay height). */
  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  /** The composer floats above the tab bar on mobile; --composer-h tracks its height. */
  const composerRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<{ close(): void } | null>(null);
  /** Serialises sends — see the guard at the top of send(). */
  const sendLockRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachRef = useRef<((run: ActiveRun) => void) | null>(null);
  /** Last time the parser saw real progress (anything but thinking telemetry). */
  const lastProgressRef = useRef(Date.now());
  /** Meaningful-event count already credited to lastProgressRef. */
  const lastMeaningfulRef = useRef(0);
  /** Set once the watchdog auto-kills, so it doesn't hammer stop(). */
  const autoKilledRef = useRef(false);
  /**
   * Set when this client asked the server to kill the job. A 'killed' close
   * we initiated (stop button, watchdog) is not an interruption; one we
   * didn't means the service restarted under the run and the turn is dead.
   */
  const stopInitiatedRef = useRef(false);
  /** True once the user hides the work panel mid-turn; a fresh turn may
      auto-open it again on desktop, a reconnect to the same run must not. */
  const workDismissedRef = useRef(false);
  /** Id of the assistant message the panel is targeting — tells a reconnect
      to the same run apart from a brand-new turn. */
  const activeWorkIdRef = useRef<string | null>(null);
  /** True when the panel auto-opened for a fresh turn — on mobile it slides
      away again when the turn lands, so the answer is readable. */
  const autoOpenedRef = useRef(false);

  /* ── Persistence ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const stored = localStorage.getItem(TIER_KEY);
    if (stored === 'fast' || stored === 'pro' || stored === 'max') setTier(stored);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
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

  /**
   * Immediate spoken ack, played before the agent boots so the gap between
   * send and the first word of the answer isn't silence. Not tied to a
   * message bubble (the ack is filler, not a reply) and deliberately left out
   * of speechRef — the answer's speak() supersedes it via the shared audio
   * element, which is the desired interrupt when the turn resolves fast.
   */
  const speakAck = useCallback(() => {
    if (muted) return;
    speakChunked(nextAck(), {
      voice: parseInt(localStorage.getItem('sam-tts-voice') ?? '21', 10),
    });
  }, [muted]);

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
    lastProgressRef.current = Date.now();
    lastMeaningfulRef.current = 0;
    autoKilledRef.current = false;
    stopInitiatedRef.current = false;
    setStuck(false);
    setRunning(true);
    setPhase('starting');
    setServerPhase(null);
    setError(null);

    // Point the work panel at this turn. A reconnect to the SAME run must not
    // re-trigger the auto-open the user may have dismissed mid-turn.
    const freshTurn = activeWorkIdRef.current !== run.assistantId;
    activeWorkIdRef.current = run.assistantId;
    setWorkMessageId(run.assistantId);
    if (freshTurn) workDismissedRef.current = false;
    // Auto-open on every screen now — on mobile the sheet slides up so the
    // thinking is actually visible, then drops again when the turn lands.
    if (freshTurn && !workDismissedRef.current) {
      autoOpenedRef.current = true;
      setWorkOpen(true);
    }

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === run.assistantId ? fn(m) : m)));

    const finalise = (
      exitCode: number | null,
      status: 'exited' | 'killed' | 'lost',
    ) => {
      const state = parser.finish(exitCode);
      const cost = computeCost(run.tier, state.usage, state.reportedCostUsd);

      if (state.sessionId) localStorage.setItem(SESSION_KEY, state.sessionId);
      localStorage.removeItem(ACTIVE_KEY);
      if (cost) setSessionCost((c) => c + cost.usd);

      const lost = status === 'lost';
      // A 'killed' close we didn't initiate means the service restarted under
      // this run. The job is gone; don't reconnect and don't auto-speak a
      // truncated answer — say what happened so it reads as an interruption,
      // not a silent dead-end.
      const interrupted = status === 'killed' && !stopInitiatedRef.current;

      // Spoken text comes from the parser's final blocks directly, NOT from a
      // value written inside the setMessages updater below — React defers that
      // updater to the next render, so anything assigned in it would still be
      // unset here and auto-speak would silently never fire.
      const spoken = lost || interrupted
        ? ''
        : spokenText({ id: run.assistantId, role: 'assistant', blocks: state.blocks, done: true });
      patch((m) => ({
        ...m,
        blocks: lost
          ? [...state.blocks, { kind: 'error' as const, text: 'Lost connection to this run.' }]
          : interrupted
            ? [...state.blocks, { kind: 'error' as const, text: 'This run was interrupted — the service restarted. Send your message again.' }]
            : [...state.blocks],
        sessionId: state.sessionId,
        usage: state.usage,
        cost,
        durationMs: state.durationMs,
        done: true,
      }));

      setRunning(false);
      setPhase('done');
      setStuck(false);
      activeJobRef.current = null;
      // The mobile sheet covered the chat to show the working; once the answer
      // is here, put it away. Manually-opened panels stay.
      if (isNarrowScreen() && autoOpenedRef.current) setWorkOpen(false);
      if (!muted && !lost && !interrupted && spoken) void speak(run.assistantId, spoken);
    };

    streamRef.current = jobsService.stream(run.jobId, (event) => {
      if (event.type === 'phase') {
        // Server-named pre-output gap (spawn/context) — the parser has
        // nothing to say until the first byte, so trust the ping for the
        // status line.
        setServerPhase({ phase: event.phase, ms: event.ms });
      } else if (event.type === 'output') {
        retriesRef.current = 0;
        const state = parser.push(event.text);
        // Only real progress (text, tool calls, results) resets the stuck
        // clock — a flood of thinking telemetry must not.
        if (state.meaningful > lastMeaningfulRef.current) {
          lastMeaningfulRef.current = state.meaningful;
          lastProgressRef.current = Date.now();
        }
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
        finalise(event.exitCode, event.status);
      }
    });
  }, [muted, speak]);

  // Lets the stream callback re-enter attachToRun without a circular dep.
  attachRef.current = attachToRun;

  /* ── Reconnect when the app comes back to the foreground ─────────────── */

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;

      // Coming back from a lock/background: reset the stuck clock before any
      // watchdog tick can run, so time spent with the screen off is never
      // counted against a job that was working the whole time. attachToRun
      // also resets it; this makes the reset independent of finding a run.
      lastProgressRef.current = Date.now();

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

    // `running` is a render-time closure, so a hands-free re-fire landing
    // before the next render could otherwise start two turns. The lock closes
    // that window; it is released on the OS path below or in the finally.
    if (sendLockRef.current) return;
    sendLockRef.current = true;

    // The wake prompt has served its purpose once he's said something.
    setWokenByVoice(false);

    // A fresh send supersedes any message waiting on a biometric unlock.
    localStorage.removeItem(PENDING_KEY);

    // Unlock audio while we still have user activation. By the time the
    // answer lands, seconds later, the gesture has expired and the browser
    // would refuse to play anything.
    primeSpeech();

    // Device commands are resolved on the phone itself — "open Spotify" should
    // not cost a model round trip, and it keeps working when the agent is slow
    // or the tier is expensive. Anything that is not clearly a device command,
    // or that the phone could not carry out, falls through to the agent below
    // exactly as before. On desktop there is no bridge, so this is a no-op.
    const osResult = await tryOsIntent(message);
    if (osResult.handled && osResult.reply) {
      sendLockRef.current = false;
      const osStamp = Date.now();
      const osReplyId = `a_${osStamp}`;
      setMessages((prev) => [
        ...prev,
        { id: `u_${osStamp}`, role: 'user', blocks: [{ kind: 'text', text: message }], done: true },
        { id: osReplyId, role: 'assistant', blocks: [{ kind: 'text', text: osResult.reply! }], done: true },
      ]);
      setInput('');
      setError(null);
      if (!muted) void speak(osReplyId, osResult.reply);
      return;
    }

    try {
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
        // Always resume the conversation — every fresh session re-reads the
        // whole context (that's the "starting session / rereads everything"
        // behaviour). Runaway turns are the watchdog's job; the old token gate
        // existed only to fit under the removed budget cap.
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

        // The turn is definitely running — speak the ack before the agent
        // boots, so the boot/context/thinking gap isn't dead air.
        speakAck();

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
      // muted/speak are here for the OS-intent reply above; attachToRun already
      // depends on both, so this adds no extra churn.
    } finally {
      sendLockRef.current = false;
    }
  }, [running, tier, attachToRun, muted, speak, speakAck]);

  /* ── Hands-free loop wiring ──────────────────────────────────────────── */

  const onHandsFreeTranscribe = useCallback((text: string) => {
    primeSpeech();
    void send(text);
  }, [send]);

  const onHandsFreeCancel = useCallback(() => {
    setHandsFree(false);
    setWokenByVoice(false);
  }, []);

  const onHandsFreeFallback = useCallback((message: string) => {
    setHandsFreeFailed(message);
  }, []);

  /* ── Stop ────────────────────────────────────────────────────────────── */

  const stop = useCallback(async () => {
    const jobId = activeJobRef.current;
    if (!jobId) return;
    stopInitiatedRef.current = true;
    try { await jobsService.kill(jobId); } catch { /* already gone */ }
  }, []);

  /* ── Stuck watchdog — a pure-thinking runaway must not pin the tab ─────── */

  // A turn that emits nothing but DeepSeek thinking telemetry is a runaway,
  // not a working agent. Warn once the quiet stretch is long, then kill it.
  useEffect(() => {
    if (!running) {
      setStuck(false);
      return;
    }
    lastProgressRef.current = Date.now();
    const id = setInterval(() => {
      // A locked or backgrounded phone is not a stuck job — the WebView is
      // suspended and legitimately receives no stream events while the run
      // carries on server-side. Counting that wall-clock silence against the
      // job would kill a healthy long turn the moment the screen unlocks, so
      // the watchdog only counts time the page is actually visible.
      if (document.visibilityState !== 'visible') return;
      const stuckMs = Date.now() - lastProgressRef.current;
      if (stuckMs > STUCK_KILL_MS) {
        if (!autoKilledRef.current) {
          autoKilledRef.current = true;
          setStuck(true);
          setError('SAM got stuck thinking with no progress and was stopped. Try again.');
          void stop();
        }
      } else if (stuckMs > STUCK_WARN_MS) {
        setStuck(true);
      } else {
        setStuck(false);
      }
    }, 2_000);
    return () => clearInterval(id);
  }, [running, stop]);

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

  useEffect(() => {
    // Desktop only. On a phone this fired while the boot overlay still covers
    // the screen; the layout churn as it unmounts dismissed the keyboard and
    // the input went dead until the tab was remounted. On touch it opens on tap.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  /* ── Soft keyboard — lift the composer above it ──────────────────────── */

  // Android browsers default to interactive-widget=resizes-visual: the keyboard
  // shrinks the VISUAL viewport and overlays the layout viewport. Stock Chrome
  // honours interactive-widget=resizes-content (meta in layout.tsx) and resizes
  // the layout viewport instead — but Brave ignores it. So the overlay height is
  // measured here as innerHeight − visualViewport bottom edge, which is the
  // keyboard height when the layout viewport does NOT resize, and 0 when it
  // DOES (innerHeight shrinks with the keyboard). Either way the lift is exact.
  // The composer is fixed, so this changes no layout the IME is trying to scroll.
  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!vv || !root) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const overlay = Math.max(0, window.innerHeight - (vv.offsetTop || 0) - vv.height);
        root.style.setProperty('--kb', `${overlay}px`);
        // The added padding pushes the newest message up behind the composer;
        // if the thread was pinned to the bottom, re-pin it so the latest
        // message stays visible while typing.
        const msgs = messagesRef.current;
        if (msgs && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 48) {
          msgs.scrollTop = msgs.scrollHeight;
        }
      });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* The composer floats (mobile), so the message list needs its height as
     bottom padding for the last message to clear it. */
  useEffect(() => {
    const root = rootRef.current;
    const composer = composerRef.current;
    if (!root || !composer) return;
    const setHeight = () => root.style.setProperty('--composer-h', `${composer.offsetHeight}px`);
    setHeight();
    const ro = new ResizeObserver(setHeight);
    ro.observe(composer);
    return () => ro.disconnect();
  }, []);

  /* ── Wake-word launch ────────────────────────────────────────────────── */

  // The Android service opens this page as /chat?wake=1&os_port=8765 when it
  // hears the wake word. The port is where the native OS bridge is listening;
  // recording it here is what lets "open Spotify" reach the phone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const port = params.get('os_port');
    configureOsBridge(port ? Number(port) : null);

    if (params.get('wake') === '1') {
      // Arriving via the wake word is a user action in spirit, but not one the
      // browser recognises, so speech stays blocked until the first real tap.
      primeSpeech();
      setWokenByVoice(true);
      setHandsFree(true);
      setHandsFreeFailed(null);
    }
  }, []);

  /* ── Desktop wake word ───────────────────────────────────────────────── */

  // The phone is *launched* at /chat?wake=1 when its wake word fires. On the
  // desktop this page is already open, so there is nothing to navigate — the
  // bridge publishes a counter instead and this watches it change. Polling
  // rather than a socket because the voice service's WebSocket accepts a
  // single connection, which the voice widget already holds.
  useEffect(() => {
    if (/android|iphone|ipad|ipod/i.test(navigator.userAgent)) return;

    let alive = true;
    let seen: number | null = null;

    const tick = async () => {
      const seq = await desktopWakeSeq();
      if (!alive || seq === null) return;
      // First read only establishes the baseline; a page opened hours after a
      // detection must not think it was just woken.
      if (seen === null) {
        seen = seq;
        return;
      }
      if (seq === seen) return;
      seen = seq;
      setWokenByVoice(true);
      setHandsFree(true);
      setHandsFreeFailed(null);
    };

    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /** Three-tier cycle — Fast → Pro → Max → Fast. The button shows the current
      tier; tapping steps to the next one. */
  const NEXT_TIER: Record<TierId, TierId> = { fast: 'pro', pro: 'max', max: 'fast' };
  const toggleTier = () => {
    const next = NEXT_TIER[tier];
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
    setWorkOpen(false);
    setWorkMessageId(null);
    workDismissedRef.current = false;
    activeWorkIdRef.current = null;
    autoOpenedRef.current = false;
  };

  /* ── Work panel helpers ──────────────────────────────────────────────── */

  const openWork = (id: string) => {
    workDismissedRef.current = false;
    autoOpenedRef.current = false;
    setWorkMessageId(id);
    setWorkOpen(true);
  };

  const closeWork = () => {
    workDismissedRef.current = true;
    autoOpenedRef.current = false;
    setWorkOpen(false);
  };

  /* Escape closes the panel — keyboard users shouldn't need the X. */
  useEffect(() => {
    if (!workOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeWork();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workOpen]);

  /* The panel always shows one message's work — defaulting to the running
     turn — and derives its blocks from that message each render, so a live
     turn streams into it without any extra state. */
  const workMessage = workMessageId
    ? messages.find((m) => m.id === workMessageId && m.role === 'assistant')
    : undefined;
  const workBlocks = workMessage ? splitBlocks(workMessage.blocks).work : [];
  /** The status line is only truthful while the panel targets the live turn. */
  const panelRunning = running && workMessage?.id === activeWorkIdRef.current;
  const panelTitle = panelRunning ? 'SAM · working' : 'SAM · work';

  /* ── Render ──────────────────────────────────────────────────────────── */

  // Prefer the server's phase name while the parser is still in a pre-output
  // gap (starting/thinking); it names the delay truthfully and carries ms
  // since process start. Once content flows, the parser's label wins.
  const serverLabel =
    serverPhase && (phase === 'starting' || phase === 'thinking')
      ? SERVER_PHASE_LABEL[serverPhase.phase]
      : null;
  const statusLabel = serverLabel || PHASE_LABEL[phase] || 'Working';
  const statusSeconds =
    serverLabel && serverPhase
      ? `${(serverPhase.ms / 1000).toFixed(1)}s`
      : elapsed > 1
        ? `${elapsed}s`
        : '';

  return (
    <div ref={rootRef} className="sam-chat-root flex flex-col md:flex-row">
      {/* Chat column — answers only. Work streams into the panel below. */}
      <div className="flex-1 flex flex-col min-w-0">
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
              : tier === 'pro'
                ? 'text-sky-300 bg-sky-900/20 border-sky-700/40'
                : 'text-amber-300 bg-amber-900/20 border-amber-700/40'
          }`}
          title={
            tier === 'fast'
              ? 'Fast tier — DeepSeek flash, cheap, separate quota. Tap for Pro.'
              : tier === 'pro'
                ? 'Pro tier — DeepSeek pro, stronger, ~3x the cost of Fast. Tap for Max.'
                : 'Max tier — Claude, uses your subscription quota. Tap for Fast.'
          }
        >
          {tier === 'fast' ? (
            <Zap size={12} />
          ) : tier === 'pro' ? (
            <Cpu size={12} />
          ) : (
            <Sparkles size={12} />
          )}
          {tier === 'fast' ? 'Fast' : tier === 'pro' ? 'Pro' : 'Max'}
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
      <div ref={messagesRef} className="chat-messages flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-20">
            <Cpu size={32} className="text-accent/40" />
            <h2 className="text-lg font-bold text-dim-200">SAM</h2>
            <p className="text-sm text-dim-400">IS EVERYWHERE</p>
          </div>
        )}

        {messages.map((msg) => {
          const { answer, work } = splitBlocks(msg.blocks);
          const showWork = msg.role === 'assistant' && work.length > 0;
          const selected = workOpen && workMessageId === msg.id;
          return (
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
              <AnswerBlocks blocks={answer} />

              {showWork && (
                <button
                  type="button"
                  onClick={() => openWork(msg.id)}
                  className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
                    selected ? 'text-accent' : 'text-dim-300 hover:text-dim-100'
                  }`}
                >
                  <Wrench size={12} />
                  View work
                  <span className="text-dim-500">· {work.length}</span>
                </button>
              )}

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
          );
        })}

        {/* Live progress — the cold start is real, so show what it is doing.
            The status line prefers the server's phase ping (Booting SAM /
            Loading context / Replying) with ms since process start while the
            parser is still in a pre-output gap. */}
        {running && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 text-xs text-dim-400 px-3 py-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span>{statusLabel}…</span>
              {statusSeconds && <span className="font-mono text-dim-500">{statusSeconds}</span>}
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

        {stuck && running && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-amber-300 bg-amber-900/20 px-3 py-1.5 rounded-full border border-amber-700/40">
              SAM is stuck — thinking with no progress. Stopping automatically.
            </span>
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

      {/* Composer — floats above the tab bar on mobile (see .chat-composer),
          in-flow on desktop. */}
      <div
        ref={composerRef}
        className="chat-composer shrink-0 border-t border-void-700 bg-void-900/80 backdrop-blur-md
                   px-3 py-2.5 md:px-6 md:py-3 space-y-2"
      >
        {handsFree && !handsFreeFailed && (
          <p className="text-center text-[11px] tracking-wide text-accent">
            Hands-free — speak, or tap to stop.
          </p>
        )}
        {wokenByVoice && handsFreeFailed && (
          <p className="text-center text-[11px] tracking-wide text-accent">
            Woken by voice — hold the mic to speak.
          </p>
        )}

        {audioBlocked && !muted && (
          <p className="text-center text-[11px] text-dim-400">
            Your browser blocked autoplay — tap the speaker on a reply to hear it.
          </p>
        )}

        <div className="flex justify-center">
          {handsFree && !handsFreeFailed ? (
            <HandsFreeMic
              enabled={handsFree}
              working={running}
              speaking={speaking !== null}
              onTranscribe={onHandsFreeTranscribe}
              onCancel={onHandsFreeCancel}
              onFallback={onHandsFreeFallback}
            />
          ) : (
            <VoiceRecordButton
              onTranscribe={(text) => {
                primeSpeech();
                void send(text);
              }}
            />
          )}
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

      {/* Work panel — desktop: in-flow side panel. The main thread stays
          answers-only; everything SAM did to get there lives here. */}
      {workOpen && workMessage && !isNarrow && (
        <aside className="hidden md:flex w-[320px] lg:w-[380px] shrink-0 border-l border-void-700 h-full">
          <WorkPanel
            title={panelTitle}
            running={panelRunning}
            phaseLabel={statusLabel}
            statusSeconds={statusSeconds}
            stuck={stuck}
            blocks={workBlocks}
            onClose={closeWork}
            onStop={stop}
          />
        </aside>
      )}

      {/* Work panel — mobile: bottom sheet. Portaled to <body> so it escapes
          main's z-10 stacking context — inside main it could never rise above
          the tab bar (root z-50), which is what clipped the old drawer. */}
      {workOpen && workMessage && isNarrow &&
        createPortal(
          <div className="fixed inset-0 z-[100]">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={closeWork}
              aria-hidden="true"
            />
            <div className="absolute inset-x-0 bottom-0 h-[68%] rounded-t-2xl border-t border-void-700 overflow-hidden">
              <WorkPanel
                title={panelTitle}
                running={panelRunning}
                phaseLabel={statusLabel}
                statusSeconds={statusSeconds}
                stuck={stuck}
                blocks={workBlocks}
                onClose={closeWork}
                onStop={stop}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
