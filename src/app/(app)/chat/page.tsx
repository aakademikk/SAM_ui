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

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, Cpu, Volume2, VolumeX, Zap, Sparkles, Gem, Lock, Square, Wrench, Paperclip, Menu, X as XIcon, ArrowRightLeft } from 'lucide-react';

import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { HandsFreeMic } from '@/components/voice/HandsFreeMic';
import { desktopWakeSeq } from '@/lib/desktopBridge';
import { splitBlocks, AnswerBlocks } from '@/components/chat/MessageBlocks';
import { WorkPanel } from '@/components/chat/WorkPanel';
import { ChatList } from '@/components/chat/ChatList';
import { displayTier, tierLocked, type TierDisplayChat, type TierLockChat } from '@/lib/chatTier';
import { readMessage as readCrossTab } from '@/lib/crossTab';
import { jobsService } from '@/lib/jobsService';
import { ApiError } from '@/lib/dashboardService';
import { authService } from '@/lib/authService';
import { startAgentTurn, StepUpRequiredError } from '@/lib/chatAgentService';
import { AgentStreamParser, type AgentPhase } from '@/lib/agentStream';
import { computeCost, formatCost, formatTokens } from '@/lib/costing';
import {
  spokenText,
  type ChatAccount,
  type ChatBlock,
  type ChatMessage,
  type ChatSummary,
  type ChatTier,
  type TierId,
  type TierInfo,
} from '@/types/chat';
import { speakChunked, primeSpeech, isSpeechBlocked, stopAllSpeech, type SpeechHandle } from '@/lib/speech';
import { setSamActivity, clearSamActivity } from '@/lib/samActivity';
import { configureOsBridge, phoneWakeSeq } from '@/lib/osBridge';
import { newWakeTracker, observeWakeSeq } from '@/lib/wakeSeq';
import { tryOsIntent } from '@/lib/osIntentRunner';
import {
  clearActiveRun,
  getCurrentChatId,
  loadActiveRun,
  loadChatMessages,
  migrateLegacy,
  saveActiveRun,
  saveChatMessages,
  setCurrentChatId,
  startDraft,
} from '@/lib/chatLocal';
import { clearedHandoffFields } from '@/lib/chatHandoff';
import { tabId } from '@/lib/tabId';
import { handleChatLink, mountOpenTarget } from '@/lib/chatOpen';
import { holdPendingMessage, recoverPendingMessage, supersedePendingMessage } from '@/lib/pendingSend';
import {
  adopt as adoptChat,
  handoff as handoffChat,
  listChats as listChatsOnServer,
  openChat as openChatOnServer,
  sendFocus,
} from '@/lib/chatsService';

// MESSAGES_KEY, ACTIVE_KEY, SESSION_KEY and PENDING_KEY were the old
// single-conversation globals; T14 replaced the first three with per-chat
// storage (chatLocal.ts) — a chat id IS its CLI session id, already known
// from startAgentTurn's returned chatId (run.chatId), so nothing here writes
// sam-agent-session again; it is only ever read, once, by migrateLegacy.
// PENDING_KEY's per-chat replacement is pendingSend.ts (review finding 4).
const TIER_KEY = 'sam-agent-tier';

/** A chat's tier is fixed after its first message (spec must-do 9); TIER_KEY
 *  only ever remembers the free-choice tier for the next draft. Read on mount
 *  and whenever New points the screen back at a draft — never when opening an
 *  existing chat, whose own tier comes from its server record instead. */
function readStoredTier(storage: Storage): TierId | null {
  const stored = storage.getItem(TIER_KEY);
  return stored === 'fast' || stored === 'pro' || stored === 'max' || stored === 'max2' || stored === 'gemini'
    ? stored
    : null;
}

/** What POST /api/uploads hands back for one saved file. */
interface StagedFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

/**
 * The picker's filter. It is a hint, not a control — the server decides what it
 * accepts, and a phone will offer its camera roll regardless.
 */
const ACCEPT_ATTR =
  'image/*,video/*,.pdf,.txt,.md,.csv,.json,.rtf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
/** Dropped connections are retried before a turn is declared lost. */
const MAX_RECONNECTS = 5;
/** A turn stuck in pure thinking (no text/tool output) for this long is a runaway. */
const STUCK_WARN_MS = 180_000;
/** Auto-kill a turn that has produced nothing for this long. Was 150s — too
 * aggressive for an agent mid-tool: a long build, scrape or tool call emits no
 * stream events for minutes. Raised to give real work room while still catching
 * a genuinely wedged turn. */
const STUCK_KILL_MS = 480_000;
/** How long a server phase ping stays trustworthy. The server re-sends one
 * every second for as long as the job is running, so a ping older than this
 * means the stream has stopped talking to us — the label it carried is stale
 * and must not keep being shown as if it were current. Four missed beats. */
const SERVER_PHASE_TTL_MS = 4_000;

/** Shown once, at the top of the turn, when a resume lands past output the
 * server no longer retains. Rendered as an error block because it *is* a loss:
 * the alternative is a hole in the transcript presented as complete output. */
const TRUNCATED_NOTICE: ChatBlock = {
  kind: 'error',
  text: 'Earlier output was trimmed — the server keeps only the most recent 1 MB of a run.',
};

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
  /** The chat this run belongs to — lets finalise() and the reattach effects
      clear/find the right per-chat `sam-chat-active:<id>` slot (T14). */
  chatId: string;
}

/** The on-screen chat's own tier, turn count and handoff fields (spec
 *  must-do 9, 9b; T19) — a subset of `ChatRecord`/`ChatSummary`, both of
 *  which carry exactly these fields plus others this page doesn't need. */
interface ChatInfo {
  tier: ChatTier;
  turns: number;
  handedOffTo?: string;
  handedOffFrom?: string;
  handoffError?: string;
}

/** The on-screen chat's own history, or [] for a draft or before the current
    chat id is known (e.g. the instant before migrateLegacy/adopt runs).
    Also [] during the server prerender, which has no localStorage — the old
    flat-key loadMessages caught the resulting ReferenceError incidentally via
    its try/catch; this guard is the explicit equivalent. */
function loadMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  const id = getCurrentChatId(localStorage);
  if (!id || id === 'draft') return [];
  return loadChatMessages(localStorage, id);
}

/** Display names for the Handoff tier picker — all five tiers, same tier
 *  allowed (spec must-do 9b). Labels only; "Do not touch: the tier colours
 *  and icons" is about the tier button itself, not this plain list. */
const TIER_PICKER_LABEL: Record<TierId, string> = {
  fast: 'Fast',
  pro: 'Pro',
  max: 'Max',
  max2: 'Max 2',
  gemini: 'Gemini',
};

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

const REATTACH_TIER_LABEL: Record<TierId, string> = {
  fast: 'Fast',
  pro: 'Pro',
  max: 'Max',
  max2: 'Max 2',
  gemini: 'Gemini',
};

/**
 * A minimal `TierInfo` for reattaching to a run opened from the chat list
 * rather than started by this tab — `startAgentTurn`'s response is what
 * normally supplies the real one (model id, rates), but a reattach never
 * calls that endpoint. `unknown` resolves the same way startTurn.ts resolves
 * it server-side: tierEnv('max') on the main account, tierEnv('max2') on
 * max2. No `rates` means computeCost trusts the CLI's own reported figure —
 * exactly what happens for max/max2 already, since neither tier ships rates.
 */
function reattachTierInfo(tier: ChatTier, account: ChatAccount): TierInfo {
  const id: TierId = tier === 'unknown' ? (account === 'max2' ? 'max2' : 'max') : tier;
  return {
    id,
    label: REATTACH_TIER_LABEL[id],
    model: '',
    thirdParty: id === 'fast' || id === 'pro' || id === 'gemini',
  };
}

function ChatPageInner() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  /** The chat on screen: a real chat id, or `'draft'` before the first
      message of a new chat is sent. The lazy initialiser mirrors loadMessages
      so the two never disagree on the very first render; the migrate/adopt
      mount effect below corrects both for a pre-upgrade device (T14). Guarded
      the same way loadMessages is — there is no localStorage during the
      server prerender, which must fall back to 'draft' rather than throw. */
  const [currentId, setCurrentId] = useState<string>(
    () => (typeof window === 'undefined' ? 'draft' : getCurrentChatId(localStorage) ?? 'draft'),
  );
  /** Mirrors currentId for code that cannot trust a render closure — async
      work (send's startAgentTurn call, a late stream event) reads this at
      the moment it resolves rather than whatever chat was on screen when it
      started, so it never acts on a chat Colin has since switched away from
      (T17). Written synchronously at every setCurrentId call site, not via
      an effect — an effect lands a render late, which is exactly the window
      a fast-resolving stream event could land in. */
  const currentIdRef = useRef(currentId);
  // A per-tab id for the focus heartbeat (review finding 9) — lazy-initialised
  // so the `sessionStorage` read never runs during the server prerender.
  // Stable for this tab's whole life: a reload keeps it, a new tab mints its
  // own, which is exactly what lets the server tell two tabs on one device
  // apart instead of their reports overwriting each other.
  const tabIdRef = useRef<string | null>(null);
  if (tabIdRef.current === null) {
    tabIdRef.current = typeof window === 'undefined' ? '' : tabId(sessionStorage);
  }
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);

  // Staged uploads. The bytes are already on the server by the time a file
  // appears here — uploading on pick rather than on send means a rejected type
  // or an oversize video says so immediately, instead of after a turn has
  // already been paid for. The ref is the source of truth for `send`, because
  // `send` is a useCallback and would otherwise close over a stale list.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const stagedRef = useRef<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<AgentPhase>('starting');
  /** Latest server-side phase ping, with ms since process start. `at` is the
      local receipt time, which is what lets a stale ping be spotted. */
  const [serverPhase, setServerPhase] = useState<{ phase: string; ms: number; at: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** True while a turn is running but producing no real output — likely a runaway. */
  const [stuck, setStuck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);
  /** The chat list — polled from the server (T15), never written to directly;
      every mutation (new, open) comes back around through the next poll. */
  const [chats, setChats] = useState<ChatSummary[]>([]);
  /** The phone drawer. Ignored by the desktop sidebar, which is always shown. */
  const [listOpen, setListOpen] = useState(false);
  /** The on-screen chat's own tier, turn count and handoff fields — seeded by
      openChatById's own fetch and kept fresh by the 5s list poll below. Null
      for a draft, which has no server record. Drives the tier lock (spec
      must-do 9) and the Handoff control (9b, T19). */
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  // send() needs this at call time, not from a render closure — a hands-free
  // or wake transcript sent right after a switch must use the chat now on
  // screen's own tier, same reasoning as currentIdRef.
  const chatInfoRef = useRef<ChatInfo | null>(null);
  /** The Handoff tier picker. */
  const [handoffPickerOpen, setHandoffPickerOpen] = useState(false);
  /** Set the moment a handoff's POST resolves, cleared once its memo turn's
      `handedOffTo`/`handoffError` is seen — or the instant Colin switches away
      from the chat it belongs to (the effect below stops waiting then). */
  const [handoffWaitingFor, setHandoffWaitingFor] = useState<string | null>(null);
  /** True only for the POST round trip itself — attachToRun's own `running`
      covers the memo turn that follows. */
  const [handoffBusy, setHandoffBusy] = useState(false);
  /** A handoff call that failed outright (409 while running, 404, a network
      error) — distinct from chatInfo.handoffError, which the server sets on
      the chat record when the memo turn ran but produced no file. */
  const [handoffCallError, setHandoffCallError] = useState<string | null>(null);
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
  /** How many speech handles are currently audible — see reportSpeech(). */
  const speakingCountRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mute is a standing preference, not a per-turn one, so it is restored on
  // mount. Read in an effect rather than as the useState initialiser: the
  // server has no localStorage, and an initialiser that disagreed with the
  // server render would be a hydration mismatch.
  useEffect(() => {
    try {
      if (localStorage.getItem('sam-muted') === '1') setMuted(true);
    } catch {
      // Storage disabled (private mode) — stay unmuted rather than fail.
    }
  }, []);

  // Auto-grow the composer with its content: text wraps to new rows instead of
  // forcing a single line that scrolls sideways. CSS max-h caps the growth and
  // overflow-y-auto takes over past that. Clearing the input returns it to one
  // row (the inline height is removed so the stylesheet's default applies).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);
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
  /** The parser is reused across reconnects so a resume continues the same
      block stream instead of rebuilding it from sequence 0. */
  const parserRef = useRef<AgentStreamParser | null>(null);
  /** Highest output sequence already applied to the parser — a reconnect
      resumes from here, so a dropped mobile connection re-reads only the
      delta instead of re-streaming the whole turn. */
  const lastSeqRef = useRef(0);
  /** Set when a resume landed past output the server's bounded buffer no
      longer holds. The marker has to live in a ref rather than only in the
      message: every `output` event rebuilds the block list from the parser, so
      a block appended once would be wiped by the very replay it describes. */
  const truncatedRef = useRef(false);

  /** Re-apply the truncation marker. Idempotent — the event repeats on every
      reconnect, and the notice must sit at the top exactly once. */
  const withTruncationNotice = (blocks: ChatBlock[]): ChatBlock[] =>
    truncatedRef.current && blocks[0] !== TRUNCATED_NOTICE
      ? [TRUNCATED_NOTICE, ...blocks]
      : blocks;
  /** Times we've tried to drain a finished job after losing the stream —
      caps the retry loop on an unrecoverably flaky link. */
  const drainTriesRef = useRef(0);
  const attachRef = useRef<((run: ActiveRun, opts?: { reconnect?: boolean }) => void) | null>(null);
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

  /** Tears down the current stream and its parser state, exactly what New
      does before pointing the screen at a draft — switching chats closes the
      same door (spec must-do 6: the old chat's job itself keeps running
      server-side, only this tab's view of it is detached). */
  const resetStreamRefs = useCallback(() => {
    streamRef.current?.close();
    parserRef.current = null;
    lastSeqRef.current = 0;
    drainTriesRef.current = 0;
    truncatedRef.current = false;
    // A reconnect scheduled for the chat being left must not fire later and
    // reattach its run under whatever chat is on screen by then (T17) — the
    // chat-id guards in attachToRun's finalise/stream callback cover events
    // already in flight, but a timer that hasn't fired yet needs cancelling
    // outright.
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  }, []);

  /** Speech must stop within 0.5s of switching (spec must-do 7) — called
      first and synchronously, before anything else about the switch.
      stopAllSpeech() reaches the spoken ack too, exactly as the mute button
      already relies on; the explicit reset below is belt and braces in case
      a handle's onState somehow didn't fire. */
  const stopSpeechForSwitch = useCallback(() => {
    stopAllSpeech();
    speechRef.current = null;
    setSpeaking(null);
    speakingCountRef.current = 0;
    setSamActivity('speech', null);
  }, []);

  /* ── Persistence ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const stored = readStoredTier(localStorage);
    if (stored) setTier(stored);
  }, []);

  // A pre-upgrade device has its one chat under the old flat keys. Migrate it
  // into per-chat storage once, point the screen at it, and tell the server
  // (chatsService.adopt, T6 — session-level since review finding 2) so it
  // shows up there too. Adoption is best-effort: the migrated history is
  // already on the device and showing, regardless of whether the server call
  // lands — spec must-do 14.
  //
  // Then, migration or not, force-fetch whatever chat is on screen from the
  // server (review finding 5): without this, `chatInfo` stayed null until the
  // 5s list poll happened to find this id, which it never does for an
  // archived chat — and with `chatInfo` null, a send fell back to tier `max`
  // and a non-Max chat got a 409.
  useEffect(() => {
    const migratedId = migrateLegacy(localStorage);
    if (migratedId) {
      setCurrentId(migratedId);
      currentIdRef.current = migratedId;
      setMessages(loadChatMessages(localStorage, migratedId));
      void adoptChat(migratedId).catch(() => { /* local history already stands on its own */ });
    }
    const target = mountOpenTarget(localStorage);
    if (target) void openChatById(target, { force: true });
    // Mount only — this is a one-time upgrade/restore step, not a per-render effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // The chat list: polled every 5s while this tab is visible, and once more
  // on focus — the running marker and a title that just landed (Haiku, T7)
  // are both things another device or a background turn can change without
  // this tab doing anything. A failed poll keeps the last good list rather
  // than blanking it. Also called right after a new chat is minted (send(),
  // below) so New's own chat shows up without waiting out the interval.
  const refreshChats = useCallback(() => {
    void listChatsOnServer()
      .then((list) => {
        setChats(list);
        // Keeps the on-screen chat's tier lock and handoff fields current
        // without a second poll (spec must-do 9, 9b) — a `ChatSummary` row
        // carries exactly the fields `ChatInfo` needs. Reads the ref, not
        // `currentId`, so this effect-free callback never goes stale.
        const activeId = currentIdRef.current;
        if (activeId === 'draft') return;
        const match = list.find((c) => c.id === activeId);
        if (!match) return;
        const info: ChatInfo = {
          tier: match.tier,
          turns: match.turns,
          handedOffTo: match.handedOffTo,
          handedOffFrom: match.handedOffFrom,
          handoffError: match.handoffError,
        };
        setChatInfo(info);
        chatInfoRef.current = info;
      })
      .catch(() => { /* keep the last good list */ });
  }, []);

  useEffect(() => {
    refreshChats();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshChats();
    }, 5_000);
    window.addEventListener('focus', refreshChats);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refreshChats);
    };
  }, [refreshChats]);

  // Focus heartbeat (T10, T17): tells the server which chat this device has
  // on screen, so a turn finishing in a chat nobody is looking at gets a
  // ping and one finishing here doesn't. Reports immediately whenever the
  // chat on screen changes — "when a chat opens" per spec — then repeats
  // every 20s while the page stays visible. A draft has no chat id yet, so
  // it reports null too.
  //
  // This effect's cleanup must never send a null report: on a switch it
  // would race the next run's immediate report of the new id — sendFocus(null)
  // goes by sendBeacon, the id by fetch, and the two can land in either
  // order — leaving the server thinking nothing is on screen for up to 20s.
  // Only the mount-only effect below sends null, and only when the page is
  // actually hidden or gone.
  useEffect(() => {
    const focusId = currentId === 'draft' ? null : currentId;

    const report = () => {
      if (document.visibilityState === 'visible') sendFocus(focusId, tabIdRef.current ?? '');
    };
    report();
    const interval = setInterval(report, 20_000);

    return () => clearInterval(interval);
  }, [currentId]);

  // Owns the "nothing is on screen" side of the heartbeat: mount-only, so a
  // chat switch never triggers it. Reports null the instant the page is
  // hidden or this page goes away, and reports the current chat again (read
  // from currentIdRef, since this effect doesn't re-run per switch) when the
  // page becomes visible again.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const focusId = currentIdRef.current === 'draft' ? null : currentIdRef.current;
        sendFocus(focusId, tabIdRef.current ?? '');
      } else {
        sendFocus(null, tabIdRef.current ?? '');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      sendFocus(null, tabIdRef.current ?? '');
    };
  }, []);

  useEffect(() => {
    // A draft has no id yet to save under — its messages exist only until the
    // first send resolves one (see send(), below).
    if (messages.length === 0 || currentId === 'draft') return;
    try {
      saveChatMessages(localStorage, currentId, messages);
    } catch { /* quota */ }
  }, [messages, currentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  useEffect(() => () => {
    streamRef.current?.close();
    speechRef.current?.stop();
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    // Leaving the screen must not leave a channel pinned — the visualiser
    // lives in the AppShell and outlives this page.
    clearSamActivity();
  }, []);

  /* ── Elapsed timer — honest progress across the cold start ───────────── */

  /**
   * The ambient visualiser mirrors what SAM is doing on this screen.
   *
   * This owns the `agent` channel only. Audio playback owns `speech` and the
   * mic owns `mic`, both at higher priority — which is why this no longer has
   * to reason about `speaking` at all. It reports the turn, nothing else.
   *
   * `streaming` maps to speaking because that is SAM producing output; when
   * TTS is actually playing, the higher-priority speech channel says so
   * regardless. `working` is tool use, and now reads differently from the
   * pure-reasoning `thinking` — the status line already drew that line, the
   * graph just never did.
   */
  useEffect(() => {
    if (!running) {
      setSamActivity('agent', null);
      return;
    }
    setSamActivity(
      'agent',
      phase === 'streaming' ? 'speaking' : phase === 'working' ? 'working' : 'thinking',
    );
  }, [running, phase]);

  /** A failed turn is the one thing that outranks everything else on screen. */
  useEffect(() => {
    setSamActivity('alert', error ? 'alert' : null);
  }, [error]);

  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  /* ── Text-to-speech — final answers only ─────────────────────────────── */

  /**
   * Reports audible speech to the visualiser's `speech` channel.
   *
   * Ref-counted because two handles legitimately overlap: the spoken ack is
   * still finishing when the answer's speech starts and supersedes it through
   * the shared audio element. A plain boolean would let the ack's trailing
   * `onState(false)` clear the channel while the answer is mid-sentence.
   */
  const reportSpeech = useCallback((audible: boolean) => {
    speakingCountRef.current = Math.max(0, speakingCountRef.current + (audible ? 1 : -1));
    setSamActivity('speech', speakingCountRef.current > 0 ? 'speaking' : null);
  }, []);

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
      onState: reportSpeech,
    });
    speechRef.current = handle;

    void handle.done.then(() => {
      setAudioBlocked(isSpeechBlocked());
      setSpeaking((current) => (current === id ? null : current));
      if (speechRef.current === handle) speechRef.current = null;
    });
  }, [speaking, reportSpeech]);

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
      onState: reportSpeech,
    });
  }, [muted, reportSpeech]);

  /* ── Attach to a running turn ────────────────────────────────────────── */

  /**
   * Open the job stream and rebuild the assistant message from it.
   *
   * A fresh attach starts a new parser and replays from sequence 0. A reconnect
   * (opts.reconnect) reuses the existing parser and resumes from the last frame
   * it applied, so a dropped mobile connection only re-reads the delta instead
   * of re-streaming the whole turn.
   */
  const attachToRun = useCallback((run: ActiveRun, opts: { reconnect?: boolean } = {}) => {
    streamRef.current?.close();
    activeJobRef.current = run.jobId;

    // A reconnect reuses the parser and resumes from the last received frame —
    // re-streaming the whole turn on every drop is what turns a cheap mobile
    // retry into a fresh backpressure close. The first attach starts clean.
    const parser =
      opts.reconnect && parserRef.current ? parserRef.current : new AgentStreamParser();
    parserRef.current = parser;
    if (!opts.reconnect) {
      lastSeqRef.current = 0;
      drainTriesRef.current = 0;
      // A fresh turn has no gap yet; a reconnect keeps whatever was reported.
      truncatedRef.current = false;
    }
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
      // A finalise for a chat Colin has since switched away from must not
      // patch the chat now on screen, speak over it, or steal its running
      // state — the job keeps going server-side regardless; its own active
      // run stays in storage for a later open to pick up (T17).
      if (run.chatId !== currentIdRef.current) return;
      const lost = status === 'lost';
      // A stop we asked for (stop button or the stuck watchdog) has a
      // meaningless exit code — blaming it produces the confusing "exited with
      // code unknown" on a turn we killed ourselves.
      const selfStopped = status === 'killed' && stopInitiatedRef.current;
      const state = parser.finish(exitCode, { suppressExitError: lost || selfStopped });
      const cost = computeCost(run.tier, state.usage, state.reportedCostUsd);

      clearActiveRun(localStorage, run.chatId);
      if (cost) setSessionCost((c) => c + cost.usd);
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
            : selfStopped
              ? (state.blocks.some((b) => b.kind === 'text' || b.kind === 'tool')
                  ? state.blocks
                  : [{ kind: 'text' as const, text: 'Stopped.' }])
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
      // Drop the phase label with the turn: a ping belongs to the process it
      // came from, and the next turn boots a new one.
      setServerPhase(null);
      activeJobRef.current = null;
      // The mobile sheet covered the chat to show the working; once the answer
      // is here, put it away. Manually-opened panels stay.
      if (isNarrowScreen() && autoOpenedRef.current) setWorkOpen(false);
      if (!muted && !lost && !interrupted && spoken) void speak(run.assistantId, spoken);
    };

    streamRef.current = jobsService.stream(run.jobId, (event) => {
      // Same guard as finalise — a drop from switching away must not patch
      // the chat now on screen with this run's output (T17).
      if (run.chatId !== currentIdRef.current) return;
      if (event.type === 'phase') {
        // Server-named pre-output gap (spawn/context) — the parser has
        // nothing to say until the first byte, so trust the ping for the
        // status line.
        setServerPhase({ phase: event.phase, ms: event.ms, at: Date.now() });
      } else if (event.type === 'truncated') {
        // The output buffer is bounded, so a long turn can outgrow it and a
        // resume lands past output the server no longer holds. Say so in the
        // transcript: the alternative is a hole rendered as though the run
        // were complete, which is how a client lies without ever erroring.
        truncatedRef.current = true;
        patch((m) => ({ ...m, blocks: withTruncationNotice(m.blocks) }));
      } else if (event.type === 'output') {
        retriesRef.current = 0;
        // Belt and braces with the server's serialTick: a frame already applied
        // (same or lower sequence) must never reach the parser twice, or its
        // text is shown and spoken twice.
        if (event.seq > 0 && event.seq <= lastSeqRef.current) return;
        lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
        const state = parser.push(event.text);
        // Only real progress (text, tool calls, results) resets the stuck
        // clock — a flood of thinking telemetry must not.
        if (state.meaningful > lastMeaningfulRef.current) {
          lastMeaningfulRef.current = state.meaningful;
          lastProgressRef.current = Date.now();
        }
        setPhase(state.phase);
        patch((m) => ({ ...m, blocks: withTruncationNotice(state.blocks) }));
      } else if (event.type === 'closed') {
        // 'lost' means the connection dropped, not that the job ended — which
        // is exactly what a phone does when the app is backgrounded. The job
        // is still running server-side, so reconnect rather than give up.
        if (event.status === 'lost') {
          if (retriesRef.current < MAX_RECONNECTS) {
            retriesRef.current += 1;
            const delay = 600 * retriesRef.current;
            reconnectRef.current = setTimeout(
              () => attachRef.current?.(run, { reconnect: true }),
              delay,
            );
            return;
          }
          // Fast budget spent. The server closes 'lost' for backpressure and
          // network drops as well as for dead jobs, so finalising here would
          // kill a turn that is still working — the "exited with code unknown"
          // ghost error. Check the job's real state: keep reconnecting on a
          // slow cadence while it runs, and only end the turn once it's gone.
          void jobsService
            .get(run.jobId)
            .then((job) => {
              // Re-checked here, not just at the top of this callback — this
              // resolves well after that check ran, and a switch in the
              // meantime must not schedule a reconnect or finalise against
              // the chat now on screen (T17).
              if (run.chatId !== currentIdRef.current) return;
              if (job?.status === 'running') {
                retriesRef.current = 0;
                reconnectRef.current = setTimeout(
                  () => attachRef.current?.(run, { reconnect: true }),
                  4_000,
                );
                return;
              }
              if (!job || drainTriesRef.current >= 3) {
                // Pruned or drained too many times — nothing left to fetch.
                finalise(event.exitCode, event.status);
                return;
              }
              // Finished while we were disconnected — reconnect once to drain
              // the tail and get the real exit code instead of finalising a
              // truncated view of the turn.
              drainTriesRef.current += 1;
              reconnectRef.current = setTimeout(
                () => attachRef.current?.(run, { reconnect: true }),
                0,
              );
            })
            .catch(() => {
              if (run.chatId !== currentIdRef.current) return;
              finalise(event.exitCode, event.status);
            });
          return;
        }
        finalise(event.exitCode, event.status);
      }
    }, { fromSeq: opts.reconnect ? lastSeqRef.current : 0 });
  }, [muted, speak]);

  // Lets the stream callback re-enter attachToRun without a circular dep.
  attachRef.current = attachToRun;

  /* ── Open a chat from the list, `?c=`, or an adopted link ─────────────── */

  /**
   * Switches the screen to another chat. The local cache paints first (if
   * this device has one) so the switch feels instant, then the server's copy
   * — the source of truth, spec must-do 4, 5 — overwrites it. A chat with a
   * turn still running has that turn's unfinished pair dropped from the
   * server's history (chatActions.ts' openChat), so a placeholder assistant
   * message is added here for attachToRun to stream into, full replay from 0,
   * same as a turn this tab started itself.
   *
   * `force` bypasses the "already on screen" short-circuit below — the mount
   * restore (review finding 5) needs the server read to run even though
   * `currentId` already names this chat, because nothing has fetched its
   * record from the server yet. Returns whether the open succeeded, so a
   * caller such as the `?c=` link handler (review finding 1) can decide
   * whether it is safe to consume.
   */
  const openChatById = useCallback(async (id: string, opts: { force?: boolean } = {}): Promise<boolean> => {
    if (id === currentId && !opts.force) {
      if (isNarrow) setListOpen(false);
      return true;
    }

    stopSpeechForSwitch();

    resetStreamRefs();
    setRunning(false);
    setPhase('done');
    setServerPhase(null);
    setStuck(false);
    setError(null);
    setNeedsStepUp(false);
    setSessionCost(0);
    setWorkOpen(false);
    setWorkMessageId(null);
    workDismissedRef.current = false;
    activeWorkIdRef.current = null;
    autoOpenedRef.current = false;
    // The old chat's tier lock, handoff state and picker belong to the
    // screen leaving, not the one arriving (spec must-do 9, 9b).
    setChatInfo(null);
    chatInfoRef.current = null;
    setHandoffPickerOpen(false);
    setHandoffWaitingFor(null);
    setHandoffBusy(false);
    setHandoffCallError(null);

    setCurrentChatId(localStorage, id);
    setCurrentId(id);
    currentIdRef.current = id;
    // Paint whatever this device already has for it while the server read
    // below is in flight — phone and PC still end up showing the identical
    // history once it lands (spec must-do 5).
    setMessages(loadChatMessages(localStorage, id));

    try {
      const result = await openChatOnServer(id);
      // Colin may have already opened a different chat while this request was
      // in flight (e.g. open A, then B before A's response lands) — A's late
      // response must not paint over B's screen.
      if (getCurrentChatId(localStorage) !== id) return true;
      const info: ChatInfo = {
        tier: result.chat.tier,
        turns: result.chat.turns,
        handedOffTo: result.chat.handedOffTo,
        handedOffFrom: result.chat.handedOffFrom,
        handoffError: result.chat.handoffError,
      };
      setChatInfo(info);
      chatInfoRef.current = info;
      let history = result.messages;
      if (result.runningJobId) {
        const assistantId = `a_${Date.now()}`;
        // The server dropped the in-flight turn's own pair once it confirmed
        // that turn is still running (chatActions.ts's openChat); without
        // showing its prompt back here, reattaching used to leave Colin
        // looking at an answer streaming in with no question above it
        // (review finding 7).
        if (result.pendingPrompt) {
          history = [
            ...history,
            { id: `u_${Date.now()}`, role: 'user', blocks: [{ kind: 'text', text: result.pendingPrompt }], done: true },
          ];
        }
        history = [...history, { id: assistantId, role: 'assistant', blocks: [], done: false }];
        setMessages(history);
        saveChatMessages(localStorage, id, history);
        const run: ActiveRun = {
          jobId: result.runningJobId,
          assistantId,
          tier: reattachTierInfo(result.chat.tier, result.chat.account),
          chatId: id,
        };
        saveActiveRun(localStorage, id, run);
        attachToRun(run);
      } else {
        setMessages(history);
        saveChatMessages(localStorage, id, history);
      }
    } catch (err) {
      if (getCurrentChatId(localStorage) !== id) return false;
      if (err instanceof StepUpRequiredError) {
        setNeedsStepUp(true);
        setError('Biometric unlock required before SAM can run anything.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not open that chat.');
      }
      if (isNarrow) setListOpen(false);
      return false;
    }

    if (isNarrow) setListOpen(false);
    return true;
  }, [currentId, isNarrow, resetStreamRefs, attachToRun, stopSpeechForSwitch]);

  /* ── Handoff: follow the old chat to its new one (spec must-do 9b) ────── */

  // `handoffWaitingFor` is only ever this chat's own id (set right after its
  // own POST resolves, cleared on switch), so this only fires while Colin is
  // still looking at the chat that was handed off — chatInfo is kept fresh
  // for whatever's on screen by openChatById and the 5s poll above.
  useEffect(() => {
    if (!handoffWaitingFor || currentId !== handoffWaitingFor) return;
    if (chatInfo?.handedOffTo) {
      const target = chatInfo.handedOffTo;
      setHandoffWaitingFor(null);
      void openChatById(target);
    } else if (chatInfo?.handoffError) {
      setHandoffWaitingFor(null);
    }
  }, [handoffWaitingFor, currentId, chatInfo, openChatById]);

  /* ── `/chat?c=<id>` — open that chat once, when it arrives ───────────── */

  const router = useRouter();
  const searchParams = useSearchParams();
  const cParam = searchParams.get('c');
  // Which `c` value this effect has already acted on. Without this, opening
  // Y from the list (or pressing New) changes currentId while the URL still
  // says `?c=X` — the old `cParam !== currentId` guard would then see a
  // mismatch again and pull the screen back to X. Tracking "handled" instead
  // of "matches currentId" means each value is only ever opened once. The
  // ref is cleared whenever cParam goes back to empty (right after we strip
  // it below), so a later `?c=X` — e.g. a ping's deep link, or the service
  // worker's navigate — is treated as a fresh arrival and opened again.
  const handledCParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cParam) {
      handledCParamRef.current = null;
      return;
    }
    if (handledCParamRef.current === cParam) return;
    handledCParamRef.current = cParam;

    // Drop `c` from the URL once it's been handled, keeping every other
    // param intact, so it can't re-fire this effect on a later unrelated
    // re-render and so Colin can navigate away without snapping back.
    const stripCParam = () => {
      const next = new URLSearchParams(Array.from(searchParams.entries()));
      next.delete('c');
      const qs = next.toString();
      router.replace(qs ? `/chat?${qs}` : '/chat', { scroll: false });
    };

    // Session-only GET, never adopt (review finding 1): adopt needs step-up,
    // which a phone's 10-minute window has usually lost by the time a ping
    // is tapped, and it un-archives the chat as a side effect that a mere
    // deep-link open must never cause. `handleChatLink` reports whether the
    // open succeeded, so the link is consumed only then — on any failure `c`
    // stays in the URL and a reload or a second tap retries it.
    void handleChatLink(cParam, { open: (id) => openChatById(id, { force: true }) }).then((ok) => {
      if (ok) stripCParam();
    });
  }, [cParam, openChatById, router, searchParams]);

  /* ── Reconnect when the app comes back to the foreground ─────────────── */

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;

      // Coming back from a lock/background: reset the stuck clock before any
      // watchdog tick can run, so time spent with the screen off is never
      // counted against a job that was working the whole time. attachToRun
      // also resets it; this makes the reset independent of finding a run.
      lastProgressRef.current = Date.now();

      // The on-screen chat's own active run, not a device-wide global — read
      // fresh from storage rather than from the currentId closure, since this
      // listener outlives any one render (T14).
      const id = getCurrentChatId(localStorage);
      if (!id || id === 'draft') return;
      const run = loadActiveRun<ActiveRun>(localStorage, id);
      if (!run) return;

      const pending = loadMessages().find((m) => m.id === run.assistantId);
      if (!pending || pending.done) return;
      retriesRef.current = 0;
      // Resume rather than replay: if the parser already holds this turn's
      // blocks (tab backgrounded mid-stream), pick up from the last frame.
      attachRef.current?.(run, { reconnect: parserRef.current !== null });
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /* ── Reattach after the tab was left ─────────────────────────────────── */

  useEffect(() => {
    const id = getCurrentChatId(localStorage);
    if (!id || id === 'draft') return;
    const run = loadActiveRun<ActiveRun>(localStorage, id);
    if (!run) return;

    // Only reattach if that message is still unfinished.
    const pending = loadMessages().find((m) => m.id === run.assistantId);
    if (!run.jobId || !pending || pending.done) {
      clearActiveRun(localStorage, id);
      return;
    }

    // parserRef is null on a hard load (fresh JS context) — full replay from 0
    // is correct there. On a soft return it's set, so resume the same stream.
    attachToRun(run, { reconnect: parserRef.current !== null });
    // Mount only — attachToRun is stable enough for this and re-running it
    // here would reopen the stream on every speak() state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Recover a message that failed on biometric unlock ────────────────── */

  // Per-chat (review finding 4): only ever recovers the message held for the
  // chat on screen right now (`currentId`, at mount). A message written in a
  // different chat and still held for it is left exactly where it is —
  // resending it here would fire it into whatever chat this device happens
  // to be showing, not the one it was typed into.
  useEffect(() => {
    const pending = recoverPendingMessage(localStorage, currentId);
    if (!pending) return;
    void authService.checkSession().then((s) => {
      if (!s.authenticated) {
        return;
      }
      if (s.stepUp) {
        // A biometric happened elsewhere since the failure — the message can
        // go out now without another prompt.
        void send(pending);
      } else {
        // Not recovered yet — hold it again under this chat so the Unlock
        // button (or the next mount) can still find it.
        holdPendingMessage(localStorage, currentId, pending);
        setNeedsStepUp(true);
        setError('Biometric unlock required before SAM can run anything.');
      }
    });
    // Mount only — send's identity changes with running/tier; re-running this
    // on those changes would fire the pending message repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Send ────────────────────────────────────────────────────────────── */

  /* ── Uploads ─────────────────────────────────────────────────────────── */

  const setStagedBoth = useCallback((next: StagedFile[]) => {
    stagedRef.current = next;
    setStaged(next);
  }, []);

  const onPickFiles = useCallback(
    async (picked: FileList | null) => {
      if (!picked || picked.length === 0) return;

      setAttachError(null);
      setUploading(true);
      try {
        const form = new FormData();
        for (const file of Array.from(picked)) form.append('files', file);

        const response = await fetch('/api/uploads', {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        const body = (await response.json().catch(() => ({}))) as {
          data?: { files: StagedFile[] };
          error?: string;
          stepUpRequired?: boolean;
        };

        if (!response.ok) {
          // The unlock button resends a pending message, which cannot work
          // here: the FileList is gone by the time the biometric prompt
          // returns. Say what to do rather than offering a button that
          // appears to work and silently does nothing.
          if (response.status === 401 && body.stepUpRequired) {
            setNeedsStepUp(true);
            throw new Error('Unlock first, then pick the file again.');
          }
          throw new Error(body.error ?? `Upload failed (${response.status})`);
        }

        setStagedBoth([...stagedRef.current, ...(body.data?.files ?? [])]);
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [setStagedBoth],
  );

  const removeStaged = useCallback(
    (path: string) => {
      setStagedBoth(stagedRef.current.filter((f) => f.path !== path));
    },
    [setStagedBoth],
  );

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    // A turn is something said or something shown, so an empty box is only
    // fatal when there is nothing staged to carry it.
    const files = stagedRef.current;
    if ((!message && files.length === 0) || running) return;

    // `running` is a render-time closure, so a hands-free re-fire landing
    // before the next render could otherwise start two turns. The lock closes
    // that window; it is released on the OS path below or in the finally.
    if (sendLockRef.current) return;
    sendLockRef.current = true;

    // The wake prompt has served its purpose once he's said something.
    setWokenByVoice(false);

    // A fresh send to this chat supersedes any message it was still holding
    // from an earlier failed send — another chat's held message is untouched
    // (review finding 4).
    supersedePendingMessage(localStorage, currentIdRef.current);

    // Unlock audio while we still have user activation. By the time the
    // answer lands, seconds later, the gesture has expired and the browser
    // would refuse to play anything.
    primeSpeech();

    // Device commands are resolved on the phone itself — "open Spotify" should
    // not cost a model round trip, and it keeps working when the agent is slow
    // or the tier is expensive. Anything that is not clearly a device command,
    // or that the phone could not carry out, falls through to the agent below
    // exactly as before. On desktop there is no bridge, so this is a no-op.
    // Device commands are matched on the words alone, so a turn carrying files
    // never takes this path — "open Spotify" with a photo attached is a real
    // agent turn, not a device command.
    const osResult =
      files.length === 0 ? await tryOsIntent(message) : { handled: false, reply: null };
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

      // The transcript has to read sensibly for a files-only turn, so the
      // bubble falls back to naming what was sent.
      const shown = message || `${files.length} file${files.length === 1 ? '' : 's'}`;

      // Read from the ref, not the currentId closure — a hands-free or wake
      // transcript can arrive after Colin has already switched chats, and
      // must start its turn on the chat/draft it was actually said to (T17).
      const startedFrom = currentIdRef.current;
      // A chat's tier is fixed by its first message (spec must-do 9) — an
      // existing chat always sends its own tier, read from the ref so a
      // hands-free send right after a switch uses the chat now on screen's
      // tier rather than a stale render's. Only a draft is free to choose
      // (`tier`, the button's own state). An imported chat with no single
      // tier ('unknown') runs on `max` until a handoff gives it a real one —
      // same fallback the server itself applies (startTurn.ts).
      const sendTier: TierId =
        startedFrom === 'draft'
          ? tier
          : chatInfoRef.current && chatInfoRef.current.tier !== 'unknown'
            ? chatInfoRef.current.tier
            : 'max';

      setMessages((prev) => [
        ...prev,
        { id: `u_${stamp}`, role: 'user', blocks: [{ kind: 'text', text: shown }], done: true },
        { id: assistantId, role: 'assistant', blocks: [], done: false, tier: sendTier },
      ]);
      // The files are already on disk, so clearing the composer now costs a
      // re-pick at worst if the turn fails.
      setInput('');
      setStagedBoth([]);
      setAttachError(null);
      setError(null);
      setRunning(true);
      setPhase('starting');
      setServerPhase(null);

      try {
        // Always resume the conversation — every fresh session re-reads the
        // whole context (that's the "starting session / rereads everything"
        // behaviour). Runaway turns are the watchdog's job; the old token gate
        // existed only to fit under the removed budget cap.
        // undefined for a draft (no chat yet) — the server mints one and
        // hands its id back below (T14).
        const chatId = startedFrom === 'draft' ? undefined : startedFrom;
        const started = await startAgentTurn({
          message,
          tier: sendTier,
          chatId,
          attachments: files.map((f) => ({ path: f.path, name: f.name })),
        });

        // Colin may have switched away from the chat/draft this send began
        // on while the request was in flight. The run still has to be
        // reachable later, but a late response must not yank the screen to
        // it, speak over whatever is now on screen, or steal its running
        // state (T17).
        const stillOnThisChat = currentIdRef.current === startedFrom;

        if (stillOnThisChat) {
          // A draft's first send only now learns its id — switch the screen
          // over to it so history, the active run and later sends all land
          // under the same per-chat keys.
          setCurrentId(started.chatId);
          currentIdRef.current = started.chatId;
          setCurrentChatId(localStorage, started.chatId);
        }
        // A brand-new chat won't be in the store's list until this turn's
        // startTurn.ts call creates it — refresh now rather than waiting out
        // the 5s poll, so New's own chat shows up straight away (spec 3).
        // Safe regardless of stillOnThisChat — it only ever refreshes the list.
        refreshChats();

        const run: ActiveRun = {
          jobId: started.jobId,
          assistantId,
          tier: started.tier,
          chatId: started.chatId,
        };
        // Recorded before streaming starts (or even when we never attach
        // below), so a later open of this chat finds its way back to this run.
        saveActiveRun(localStorage, started.chatId, run);

        if (stillOnThisChat) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, jobId: started.jobId } : m)),
          );

          // The turn is definitely running — speak the ack before the agent
          // boots, so the boot/context/thinking gap isn't dead air.
          speakAck();

          attachToRun(run);
        }
      } catch (err) {
        const stillOnThisChat = currentIdRef.current === startedFrom;
        if (err instanceof StepUpRequiredError) {
          // Hold the message against the chat it was written in — startedFrom,
          // not whichever chat is on screen by the time Colin unlocks (review
          // finding 4). The step-up gate itself is app-wide, not per-chat, so
          // it still applies regardless of which chat is now on screen.
          holdPendingMessage(localStorage, startedFrom, message);
          setNeedsStepUp(true);
          if (stillOnThisChat) setError('Biometric unlock required before SAM can run anything.');
        } else if (stillOnThisChat) {
          setError(err instanceof Error ? err.message : 'Chat failed');
        }
        if (stillOnThisChat) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setRunning(false);
        }
      }
      // muted/speak are here for the OS-intent reply above; attachToRun already
      // depends on both, so this adds no extra churn.
    } finally {
      sendLockRef.current = false;
    }
  }, [running, tier, attachToRun, muted, speak, speakAck, setStagedBoth, refreshChats]);

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
    try {
      await jobsService.kill(jobId);
    } catch (err) {
      // A 401 here is the step-up gate, not a missing job: DELETE /api/jobs/[id]
      // requires a fresh biometric. Swallowing it — as an empty catch did —
      // makes the stop button do nothing at all, with no error shown and the
      // turn still running. That silence is half of "couldn't stop the chat".
      // Ask for the biometric once, then retry the kill.
      if (err instanceof ApiError && err.status === 401) {
        try {
          await authService.stepUp();
          await jobsService.kill(jobId);
          return;
        } catch {
          stopInitiatedRef.current = false;
          setError('Stopping needs a biometric unlock. Tap stop to try again.');
          return;
        }
      }
      // Anything else must be visible too — never a silent no-op.
      stopInitiatedRef.current = false;
      setError('Could not stop that turn — it may already have finished.');
    }
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
    const tracker = newWakeTracker();

    const tick = async () => {
      const seq = await desktopWakeSeq();
      if (!alive || !observeWakeSeq(tracker, seq)) return;
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

  /* ── Phone wake word while SAM is on screen ──────────────────────────── */

  // Relaunching the app over itself closed it (2026-10-01), so while this
  // page is visible on the phone it polls the bridge's wake counter instead.
  // The polls are also how the phone knows SAM is on screen (WakeGate.java);
  // hidden, the page stops polling and says so, and the next "Hey Sam"
  // launches the app as before.
  useEffect(() => {
    if (!/android/i.test(navigator.userAgent)) return;

    let alive = true;
    const tracker = newWakeTracker();

    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const seq = await phoneWakeSeq(true);
      if (!alive || !observeWakeSeq(tracker, seq)) return;
      setWokenByVoice(true);
      setHandsFree(true);
      setHandsFreeFailed(null);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
      else void phoneWakeSeq(false);
    };

    void tick();
    const id = setInterval(tick, 2000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /** Five-tier cycle — Fast → Pro → Max → Max 2 → Gemini → Fast. The button
      shows the current tier; tapping steps to the next one. */
  const NEXT_TIER: Record<TierId, TierId> = { fast: 'pro', pro: 'max', max: 'max2', max2: 'gemini', gemini: 'fast' };
  const toggleTier = () => {
    const next = NEXT_TIER[tier];
    setTier(next);
    localStorage.setItem(TIER_KEY, next);
  };

  const newConversation = () => {
    // New is a switch too (T17) — the chat leaving the screen may still have
    // a turn running and/or audio playing; both must be let go of exactly as
    // opening a different chat would.
    stopSpeechForSwitch();

    resetStreamRefs();
    // Points the screen at a fresh, unsaved chat. The chat leaving the
    // screen stays exactly as it was, still listed — New never wipes,
    // deletes or overwrites anything (spec must-do 3, 14; check 2).
    startDraft(localStorage);
    setCurrentId('draft');
    currentIdRef.current = 'draft';
    setMessages([]);
    setSessionCost(0);
    setError(null);
    setRunning(false);
    setPhase('done');
    setServerPhase(null);
    setWorkOpen(false);
    setWorkMessageId(null);
    workDismissedRef.current = false;
    activeWorkIdRef.current = null;
    autoOpenedRef.current = false;
    // A draft has no server record, and carries over no other chat's handoff
    // state — it picks its own tier freely (spec must-do 9).
    setChatInfo(null);
    chatInfoRef.current = null;
    setHandoffPickerOpen(false);
    setHandoffWaitingFor(null);
    setHandoffBusy(false);
    setHandoffCallError(null);
  };

  /* ── Handoff: move this chat to a new one on another tier (9b) ────────── */

  const startHandoff = async (pickedTier: TierId) => {
    if (currentId === 'draft') return;
    const id = currentId;
    setHandoffBusy(true);
    setHandoffCallError(null);
    try {
      await handoffChat(id, pickedTier);
      // The memo turn is now running in the old chat; the effect above
      // follows it via the next chatInfo refresh (openChatById's own poll,
      // or the 5s list poll) and opens handedOffTo once it lands. Clear this
      // tab's own copy of the PREVIOUS attempt's handoff fields the moment
      // that effect starts watching — otherwise it reads the old
      // handoffError/handedOffTo and acts on them as this attempt's result
      // (review finding 6; the server clears its copy the same way).
      setHandoffPickerOpen(false);
      setChatInfo((prev) => (prev ? clearedHandoffFields(prev) : prev));
      if (chatInfoRef.current) chatInfoRef.current = clearedHandoffFields(chatInfoRef.current);
      setHandoffWaitingFor(id);
    } catch (err) {
      setHandoffCallError(
        err instanceof StepUpRequiredError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not start handoff.',
      );
    } finally {
      setHandoffBusy(false);
    }
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

  // A chat's tier is fixed by its first message (spec must-do 9) — `current`
  // is the on-screen chat/draft in the shape chatTier.ts needs. `chatInfo` is
  // null for both a draft and the brief gap before an existing chat's own
  // fetch lands; `tierLocked` only needs the id for that gap (a chat id that
  // isn't 'draft' is already locked by construction — see chatTier.ts).
  const currentTierLockChat: TierLockChat = { id: currentId, turns: chatInfo?.turns };
  const tierIsLocked = tierLocked(currentTierLockChat);
  const currentTierDisplayChat: TierDisplayChat | null =
    currentId === 'draft' ? null : { id: currentId, tier: chatInfo?.tier ?? 'unknown' };
  const shownTier = displayTier(currentTierDisplayChat, tier);

  // Prefer the server's phase name while the parser is still in a pre-output
  // gap (starting/thinking); it names the delay truthfully and carries ms
  // since process start. Once content flows, the parser's label wins.
  // A ping is only worth showing while it is fresh. The server heartbeats one
  // a second for as long as the job runs, so anything older means the stream
  // has gone quiet — and showing that stale label forever is what left
  // "Booting SAM · 317.8s" frozen over a turn that was working perfectly well.
  // Freshness is read at render time; `elapsed` ticks twice a second while a
  // turn is running, so this re-evaluates on its own.
  const freshServerPhase =
    serverPhase && Date.now() - serverPhase.at < SERVER_PHASE_TTL_MS ? serverPhase : null;

  const serverLabel =
    freshServerPhase && (phase === 'starting' || phase === 'thinking')
      ? SERVER_PHASE_LABEL[freshServerPhase.phase]
      : null;
  const statusLabel = serverLabel || PHASE_LABEL[phase] || 'Working';
  const statusSeconds =
    serverLabel && freshServerPhase
      ? `${(freshServerPhase.ms / 1000).toFixed(1)}s`
      : elapsed > 1
        ? `${elapsed}s`
        : '';

  return (
    <div ref={rootRef} className="sam-chat-root flex flex-col md:flex-row">
      {/* Chat list — sidebar on desktop (in-flow, left of the chat column),
          drawer on the phone (overlay, opened by the list button below). */}
      <ChatList
        chats={chats}
        currentId={currentId}
        onOpen={openChatById}
        onNew={newConversation}
        open={listOpen}
        onClose={() => setListOpen(false)}
        onChanged={refreshChats}
        onCurrentRemoved={newConversation}
      />

      {/* Chat column — answers only. Work streams into the panel below.
          min-h-0 lets the message list scroll inside the fixed-height root
          instead of the whole page — without it a long thread carries the
          status bar away and buries the last message under the composer. */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Status bar — tier is a capability and a cost, so it stays visible.
          Sticky pins it to the top of the screen if the page itself scrolls. */}
      <div className="sticky top-0 z-20 flex items-center gap-2 px-3 py-1.5 border-b border-void-800 bg-void-900/85 backdrop-blur-md shrink-0">
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-label="Open chat list"
          title="Chats"
          className="md:hidden p-1.5 -ml-1 text-dim-300 hover:text-dim-100 rounded transition-colors shrink-0"
        >
          <Menu size={16} />
        </button>

        <button
          type="button"
          onClick={toggleTier}
          disabled={tierIsLocked}
          className={`flex items-center justify-center gap-1.5 w-20 shrink-0 text-xs px-2 py-1 rounded border
                      transition-colors disabled:opacity-40 ${
            shownTier === 'Unknown'
              ? 'text-dim-400 bg-void-800/40 border-void-700'
              : shownTier === 'fast'
                ? 'text-accent bg-accent/10 border-accent/30'
                : shownTier === 'pro'
                  ? 'text-sky-300 bg-sky-900/20 border-sky-700/40'
                  : shownTier === 'gemini'
                    ? 'text-violet-300 bg-violet-900/20 border-violet-700/40'
                    : shownTier === 'max2'
                      ? 'text-emerald-300 bg-emerald-900/20 border-emerald-700/40'
                      : 'text-amber-300 bg-amber-900/20 border-amber-700/40'
          }`}
          title={
            tierIsLocked
              ? 'Tier is fixed for this chat. Use Handoff to move.'
              : tier === 'fast'
                ? 'Fast tier — DeepSeek flash, cheap, separate quota. Tap for Pro.'
                : tier === 'pro'
                  ? 'Pro tier — DeepSeek pro, stronger, ~3x the cost of Fast. Tap for Max.'
                  : tier === 'gemini'
                    ? 'Gemini tier — Google Flash via local proxy, fastest first token. Tap for Fast.'
                    : tier === 'max2'
                      ? 'Max 2 tier — Claude account 2, separate Pro quota. Tap for Gemini.'
                      : 'Max tier — Claude, uses your main subscription quota. Tap for Max 2.'
          }
        >
          {shownTier === 'Unknown' ? (
            <Lock size={12} />
          ) : shownTier === 'fast' ? (
            <Zap size={12} />
          ) : shownTier === 'pro' ? (
            <Cpu size={12} />
          ) : shownTier === 'gemini' ? (
            <Gem size={12} />
          ) : (
            <Sparkles size={12} />
          )}
          {shownTier === 'Unknown'
            ? 'Unknown'
            : shownTier === 'fast'
              ? 'Fast'
              : shownTier === 'pro'
                ? 'Pro'
                : shownTier === 'gemini'
                  ? 'Gemini'
                  : shownTier === 'max2'
                    ? 'Max 2'
                    : 'Max'}
        </button>

        {currentId !== 'draft' && (
          <button
            type="button"
            onClick={() => {
              setHandoffCallError(null);
              setHandoffPickerOpen(true);
            }}
            disabled={running || handoffBusy || handoffWaitingFor !== null}
            className="flex items-center gap-1 text-[11px] text-dim-300 hover:text-dim-100 disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors px-1.5 py-1 rounded shrink-0"
            title="Hand off to a new chat on another tier."
          >
            <ArrowRightLeft size={12} />
            Handoff
          </button>
        )}

        {handoffWaitingFor === currentId && (
          <span className="text-[11px] text-dim-400 italic">Writing handoff memo…</span>
        )}

        {chatInfo?.handoffError && handoffWaitingFor === null && (
          <span className="text-[11px] text-red-400" title={chatInfo.handoffError}>
            Handoff failed
          </span>
        )}

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
          onClick={() => {
            const next = !muted;
            setMuted(next);
            try {
              localStorage.setItem('sam-muted', next ? '1' : '0');
            } catch {
              // Storage disabled — the toggle still works for this session.
            }
            if (next) {
              // Muting must silence what is playing NOW, not just gate the next
              // answer. stopAllSpeech() reaches the spoken ack too, which is
              // held nowhere and so cannot be stopped through speechRef.
              stopAllSpeech();
              speechRef.current = null;
              setSpeaking(null);
            }
          }}
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

      {/* Handoff tier picker — same modal styling as ChatList's delete
          confirm, so this stays in the app's existing look. */}
      {handoffPickerOpen &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setHandoffPickerOpen(false)}
              aria-hidden="true"
            />
            <div className="relative w-full max-w-sm rounded-md border border-void-700 bg-void-900 p-4 shadow-xl">
              <p className="text-sm text-dim-100 mb-3">
                Hand off to a new chat on:
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TIER_PICKER_LABEL) as TierId[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={handoffBusy}
                    onClick={() => void startHandoff(t)}
                    className="px-2 py-2 text-xs rounded border border-void-700 text-dim-200
                               hover:border-accent/60 hover:text-accent transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {TIER_PICKER_LABEL[t]}
                  </button>
                ))}
              </div>
              {handoffCallError && (
                <p className="mt-3 text-xs text-red-400">{handoffCallError}</p>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setHandoffPickerOpen(false)}
                  className="px-3 py-1.5 text-xs text-dim-300 hover:text-dim-100 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

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
                    className="flex items-center rounded-full p-1.5 -m-1.5 text-dim-200 transition-colors hover:text-accent hover:bg-void-700/70"
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
                    // Only the chat on screen right now (review finding 4) —
                    // a message held for a different chat stays held for it.
                    const pending = recoverPendingMessage(localStorage, currentIdRef.current);
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
          className="max-w-3xl mx-auto"
        >
          {(staged.length > 0 || attachError) && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {staged.map((f) => (
                <span
                  key={f.path}
                  className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1
                             bg-void-800 border border-void-600 rounded-full
                             text-void-200 text-xs"
                >
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <span className="text-dim-500">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeStaged(f.path)}
                    aria-label={`Remove ${f.name}`}
                    className="p-0.5 rounded-full text-dim-500 hover:text-red-400 transition-colors"
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
              {attachError && (
                <span className="text-xs text-red-400 bg-red-900/20 px-3 py-1 rounded-full">
                  {attachError}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                void onPickFiles(e.target.files);
                // Cleared so picking the same file twice running still fires a
                // change event the second time.
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Attach files"
              title="Attach photos, video or documents"
              className="p-2.5 bg-void-800 border border-void-600 rounded-full
                         text-dim-400 hover:text-accent hover:border-accent/40
                         disabled:opacity-40 transition-colors shrink-0"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter inserts a newline. Guarded the same way
                // as the submit button so an empty or mid-run composer never fires.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if ((input.trim() || stagedRef.current.length > 0) && !running) void send(input);
                }
              }}
              placeholder={
                running ? 'SAM is working…' : uploading ? 'Uploading…' : 'Type a message…'
              }
              disabled={running}
              rows={1}
              autoComplete="off"
              className="flex-1 bg-void-800 border border-void-600 rounded-2xl px-4 py-2.5
                         text-void-100 text-sm placeholder:text-dim-500 leading-snug
                         resize-none overflow-y-auto max-h-20 sm:max-h-40
                         focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={(!input.trim() && staged.length === 0) || running}
              className="p-2.5 bg-accent/20 border border-accent/40 rounded-full
                         text-accent hover:bg-accent/30 disabled:opacity-30
                         transition-colors shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
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

/**
 * `useSearchParams` (for `?c=`) requires a Suspense boundary around whatever
 * calls it — Next bails the whole route to client-only rendering otherwise.
 * Everything else in `ChatPageInner` already behaves on a fresh mount with no
 * `c` param, so the fallback is never actually visible in practice.
 */
export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}
