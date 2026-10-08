'use client';

/**
 * SAM — the Dashboard's chat widget (visual upgrade T14; Must 3a, 3e).
 *
 * A real SAM chat, not a link: the same multi-chat system the Chat page uses
 * (`chatsService` to list and open, `startAgentTurn` -> `/api/chat/agent` ->
 * `startTurn` to send, the job stream to read the reply), in the mockup's
 * compact "Chat with SAM" panel (e-hybrid.html `chatHTML`) and in the phone's
 * Ask SAM sheet.
 *
 * - On mount it lists the main chats and opens the most recently active one
 *   (`pickMostRecentChat`, the server list's own order). Opening is the Chat
 *   page's pattern: the server's history is the truth, and a chat with a turn
 *   still running gets its prompt plus a placeholder reply that the job
 *   stream replays into from sequence 0.
 * - The picker in the header switches to any chat in the main list, filtered
 *   by title with the Chat page's own rule (`pickerChats` -> `filterChatTitles`).
 * - Sending starts a turn in the open chat, on that chat's own tier.
 * - Hands-free: the mic button, or a "Hey Sam" while the Dashboard is on
 *   screen (`wakeToken`, from `FleetView`'s `useWakeWord`), starts the same
 *   `HandsFreeMic` loop the Chat page runs: listen, send the transcript to
 *   this widget's chat, speak the answer, listen again. The wake polling lives
 *   in `FleetView`, not here, because the phone's sheet unmounts this widget
 *   while it is closed, and the phone must keep polling while the Dashboard is
 *   visible (WakeGate.java), or a "Hey Sam" relaunches the app over itself.
 * - It keeps its own state and never writes the Chat page's per-device cache
 *   (`chatLocal`), so the Chat page's own open chat is left exactly as it was.
 *   It does report the chat on screen to the focus heartbeat (`sendFocus`), so
 *   a turn finishing here is not also pushed as a notification.
 * - Demo mode (Must 19): no chat text from the live system, so in demo mode
 *   it fetches nothing and shows a plain notice.
 *
 * Emerald only, as the rest of the Dashboard (Must 3d): the mockup's literals.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Mic, Send } from 'lucide-react';

import { HandsFreeMic } from '@/components/voice/HandsFreeMic';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { AgentStreamParser, type AgentPhase } from '@/lib/agentStream';
import { startAgentTurn, StepUpRequiredError } from '@/lib/chatAgentService';
import { listChats, openChat as openChatOnServer, sendFocus } from '@/lib/chatsService';
import { jobsService } from '@/lib/jobsService';
import { closeKind, cutOffNotice, type CloseStatus } from '@/lib/chatClose';
import { tryOsIntent } from '@/lib/osIntentRunner';
import { primeSpeech, speakChunked, stopAllSpeech, type SpeechHandle } from '@/lib/speech';
import { tabId } from '@/lib/tabId';
import { formatRelative } from '@/lib/utils';
import { isNearBottom, newUserMessageId, shouldFollow } from '@/lib/chatFollow';
import type { ChatMessage, ChatSummary, ChatTier, TierId } from '@/types/chat';

import { messageLine, pickMostRecentChat, pickerChats, sendTierFor } from './dashboardChat';

export interface DashboardChatWidgetProps {
  /** Demo mode: show no live chat at all (Must 19). */
  demo?: boolean;
  /** 'panel': the desktop's compact module and drawer tab; 'sheet': the phone's Ask SAM sheet. */
  variant?: 'panel' | 'sheet';
  /** Non-zero when a "Hey Sam" is waiting for this widget; it starts hands-free and calls `onWakeHandled`. */
  wakeToken?: number;
  onWakeHandled?: () => void;
}

/** A turn this widget is streaming. */
interface Run {
  jobId: string;
  assistantId: string;
  chatId: string;
}

const MAX_RECONNECTS = 5;
const LIST_POLL_MS = 5_000;
const FOCUS_BEAT_MS = 20_000;
/** The compact list shows the tail of the chat; the full history is on the Chat page. */
const SHOWN_MESSAGES = 40;
/** The Chat page's draft-tier memory, read (never written) for a first chat started here. */
const TIER_KEY = 'sam-agent-tier';

const PHASE_LABEL: Record<AgentPhase, string> = {
  starting: 'Starting',
  thinking: 'Thinking',
  working: 'Working',
  streaming: 'Replying',
  done: '',
};

const CSS = `
.dcw{display:flex;flex-direction:column;min-height:0;position:relative;color:#e8f7ee;font-size:12px;line-height:1.4}
.dcw[data-variant=panel]{border-radius:12px;border:1px solid rgba(61,255,90,.12);padding:14px 16px;
  background:linear-gradient(180deg,rgba(9,28,20,.82),rgba(5,17,12,.86));backdrop-filter:blur(14px) saturate(130%);-webkit-backdrop-filter:blur(14px) saturate(130%);
  box-shadow:0 24px 50px -30px rgba(0,0,0,.9),inset 0 1px 0 rgba(200,255,215,.05)}
.dcw[data-variant=sheet]{padding:4px 0 0}
.dcw-ph{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}
.dcw-pt{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#98b6a6;white-space:nowrap}
.dcw-pick{display:flex;align-items:center;gap:4px;min-width:0;max-width:62%;font-size:12px;color:#98b6a6;background:none;border:1px solid transparent;
  border-radius:7px;padding:2px 6px;cursor:pointer}
.dcw-pick:hover,.dcw-pick[aria-expanded=true]{color:#e8f7ee;border-color:rgba(157,255,112,.16);background:rgba(157,255,112,.045)}
.dcw-pick span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcw-pick i{flex:none;width:6px;height:6px;border-radius:50%;background:#3dff5a;box-shadow:0 0 6px rgba(61,255,90,.6)}
.dcw-menu{position:absolute;z-index:30;right:12px;left:12px;top:40px;border-radius:10px;border:1px solid rgba(157,255,112,.16);
  background:#06140e;box-shadow:0 18px 40px -12px rgba(0,0,0,.9);padding:6px}
.dcw[data-variant=sheet] .dcw-menu{left:0;right:0;top:34px}
.dcw-menu input{width:100%;font:inherit;font-size:12px;color:#e8f7ee;background:transparent;border:1px solid rgba(157,255,112,.075);border-radius:7px;padding:6px 8px;outline:none}
.dcw-menu input:focus{border-color:rgba(61,255,90,.34)}
.dcw-menu ul{list-style:none;margin:6px 0 0;padding:0;max-height:220px;overflow:auto;scrollbar-width:thin}
.dcw-menu li button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;font-size:12px;color:#98b6a6;background:none;border:0;border-radius:6px;padding:6px 8px;cursor:pointer}
.dcw-menu li button:hover{color:#e8f7ee;background:rgba(157,255,112,.045)}
.dcw-menu li button[aria-current=true]{color:#3dff5a;background:rgba(61,255,90,.085)}
.dcw-menu li b{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcw-menu li small{flex:none;font-size:12px;color:#5f7d6e}
.dcw-menu li i{flex:none;width:6px;height:6px;border-radius:50%;background:#3dff5a}
.dcw-menu p{margin:6px 8px;color:#5f7d6e;font-size:12px}
.dcw-msgs{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:48px;max-height:190px;overflow:auto;scrollbar-width:thin;margin-bottom:10px;padding-right:2px}
.fd[data-layout=drawer] .dcw-msgs{max-height:none}
.dcw[data-variant=sheet] .dcw-msgs{max-height:46vh;max-height:46dvh}
.dcw-msg{color:#98b6a6;white-space:pre-wrap;overflow-wrap:anywhere}
.dcw-msg b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5f7d6e;font-weight:600;margin-bottom:1px}
.dcw-msg.sam{color:#e8f7ee}
.dcw-msg.sam b{color:#3dff5a}
.dcw-msg.err{color:#ff8a8a}
.dcw-msg em{font-style:normal;color:#5f7d6e}
.dcw-note{color:#5f7d6e;font-size:12px}
.dcw-note a{color:#3dff5a;text-decoration:none}
.dcw-err{margin:0 0 8px;color:#ff8a8a;font-size:12px}
.dcw-err a{color:#3dff5a;text-decoration:none;margin-left:4px}
.dcw-voice{display:flex;flex-direction:column;align-items:center;gap:6px;margin:0 0 10px}
.dcw-voice .dcw-note button{font:inherit;color:#3dff5a;background:none;border:0;padding:0;cursor:pointer}
.dcw-ask{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 12px;border-radius:9px;border:1px solid rgba(157,255,112,.16)}
.dcw-ask:focus-within{border-color:rgba(61,255,90,.34)}
.dcw-ask input{flex:1;min-width:0;font:inherit;font-size:16px;color:#e8f7ee;background:transparent;border:0;outline:none;padding:5px 0}
.dcw-ask input::placeholder{color:#5f7d6e}
.dcw-ask button{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:7px;border:1px solid rgba(157,255,112,.075);
  background:none;color:#98b6a6;cursor:pointer}
.dcw-ask button:hover:not(:disabled){color:#3dff5a;border-color:rgba(61,255,90,.34);background:rgba(61,255,90,.085)}
.dcw-ask button:disabled{opacity:.4;cursor:default}
.dcw-ask button[aria-pressed=true]{color:#3dff5a;border-color:rgba(61,255,90,.34);background:rgba(61,255,90,.085)}
.dcw-foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:12px;color:#5f7d6e}
.dcw-foot a{color:#5f7d6e;text-decoration:none}
.dcw-foot a:hover{color:#3dff5a}
@media (prefers-reduced-motion: reduce){.dcw *{transition:none!important;animation:none!important}}
`;

function isMuted(): boolean {
  try {
    return localStorage.getItem('sam-muted') === '1';
  } catch {
    return false;
  }
}

function storedDraftTier(): TierId {
  try {
    const t = localStorage.getItem(TIER_KEY);
    if (t === 'fast' || t === 'pro' || t === 'max' || t === 'max2' || t === 'gemini') return t;
  } catch {
    /* storage disabled */
  }
  return 'fast';
}

export default function DashboardChatWidget({
  demo = false,
  variant = 'panel',
  wakeToken = 0,
  onWakeHandled,
}: DashboardChatWidgetProps) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  /** The chat on screen; null before the first pick, or when there are no chats yet (the first send starts one). */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const currentIdRef = useRef<string | null>(null);
  /** The open chat's own tier (fixed by its first message), read by send at call time. */
  const tierRef = useRef<ChatTier | null>(null);
  /** The open chat's `lastActiveAt` as last loaded: a newer one in the list poll means another device moved it on. */
  const seenActiveRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [phase, setPhase] = useState<AgentPhase>('done');
  const [error, setError] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);
  const [input, setInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef(false);
  const [handsFreeFailed, setHandsFreeFailed] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const rootRef = useRef<HTMLElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<{ close(): void } | null>(null);
  const parserRef = useRef<AgentStreamParser | null>(null);
  const lastSeqRef = useRef(0);
  const retriesRef = useRef(0);
  const drainTriesRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRunRef = useRef<Run | null>(null);
  const attachRef = useRef<((run: Run, reconnect?: boolean) => void) | null>(null);
  const openSeqRef = useRef(0);
  const sendLockRef = useRef(false);
  const speechRef = useRef<SpeechHandle | null>(null);
  const tabIdRef = useRef<string | null>(null);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  /* ── Speech: final answers only, and only in hands-free (the loop re-arms when it ends) ── */

  const speakAnswer = useCallback((text: string) => {
    speechRef.current?.stop();
    if (!text.trim()) return;
    setSpeaking(true);
    const handle = speakChunked(text, { voice: parseInt(localStorage.getItem('sam-tts-voice') ?? '21', 10) });
    speechRef.current = handle;
    void handle.done.then(() => {
      if (speechRef.current !== handle) return;
      speechRef.current = null;
      setSpeaking(false);
    });
  }, []);

  const stopSpeech = useCallback(() => {
    stopAllSpeech();
    speechRef.current = null;
    setSpeaking(false);
  }, []);

  /* ── The job stream: the Chat page's attach pattern, without its work panel or stop button ── */

  const detach = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    parserRef.current = null;
    lastSeqRef.current = 0;
    drainTriesRef.current = 0;
    activeRunRef.current = null;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  }, []);

  const attach = useCallback((run: Run, reconnect = false) => {
    streamRef.current?.close();
    activeRunRef.current = run;
    const parser = reconnect && parserRef.current ? parserRef.current : new AgentStreamParser();
    parserRef.current = parser;
    if (!reconnect) {
      lastSeqRef.current = 0;
      drainTriesRef.current = 0;
    }
    runningRef.current = true;
    setRunning(true);
    if (!reconnect) setPhase('starting');
    setError(null);

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === run.assistantId ? fn(m) : m)));

    const finalise = (exitCode: number | null, status: CloseStatus) => {
      // A run for a chat the widget has since switched away from keeps going server-side; it must not touch this one.
      if (run.chatId !== currentIdRef.current) return;
      // This widget never kills a job, so a 'killed' close means the service restarted under the run; an 'unauthorized'
      // close means the session ended mid-turn. Neither is a finished answer (chatClose).
      const notice = cutOffNotice(status, false);
      const state = parser.finish(exitCode, { suppressExitError: closeKind(status, false).suppressExitError });
      const blocks = notice ? [...state.blocks, notice] : [...state.blocks];
      const reply: ChatMessage = { id: run.assistantId, role: 'assistant', blocks, done: true };
      patch((m) => ({ ...m, blocks, sessionId: state.sessionId, usage: state.usage, durationMs: state.durationMs, done: true }));
      runningRef.current = false;
      setRunning(false);
      setPhase('done');
      activeRunRef.current = null;
      if (!notice && handsFreeRef.current && !isMuted()) speakAnswer(messageLine(reply));
    };

    streamRef.current = jobsService.stream(
      run.jobId,
      (event) => {
        if (run.chatId !== currentIdRef.current) return;
        if (event.type === 'output') {
          retriesRef.current = 0;
          if (event.seq > 0 && event.seq <= lastSeqRef.current) return;
          lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
          const state = parser.push(event.text);
          setPhase(state.phase);
          patch((m) => ({ ...m, blocks: state.blocks }));
        } else if (event.type === 'closed') {
          if (event.status !== 'lost') {
            finalise(event.exitCode, event.status);
            return;
          }
          // A dropped connection, not an ended job (a phone backgrounding the app): reconnect, as the Chat page does.
          if (retriesRef.current < MAX_RECONNECTS) {
            retriesRef.current += 1;
            reconnectRef.current = setTimeout(() => attachRef.current?.(run, true), 600 * retriesRef.current);
            return;
          }
          void jobsService
            .get(run.jobId)
            .then((job) => {
              if (run.chatId !== currentIdRef.current) return;
              if (job?.status === 'running') {
                retriesRef.current = 0;
                reconnectRef.current = setTimeout(() => attachRef.current?.(run, true), 4_000);
                return;
              }
              if (!job || drainTriesRef.current >= 3) {
                finalise(event.exitCode, event.status);
                return;
              }
              drainTriesRef.current += 1;
              reconnectRef.current = setTimeout(() => attachRef.current?.(run, true), 0);
            })
            .catch(() => {
              if (run.chatId !== currentIdRef.current) return;
              finalise(event.exitCode, event.status);
            });
        }
      },
      { fromSeq: reconnect ? lastSeqRef.current : 0 },
    );
  }, [speakAnswer]);
  attachRef.current = attach;

  /* ── Open a chat: server history, and a running turn replayed from the stream ── */

  const openChatById = useCallback(async (id: string, opts: { quiet?: boolean } = {}) => {
    const seq = ++openSeqRef.current;
    const switching = id !== currentIdRef.current;
    if (switching) stopSpeech();
    detach();
    runningRef.current = false;
    setRunning(false);
    setPhase('done');
    setError(null);
    setNeedsStepUp(false);
    currentIdRef.current = id;
    setCurrentId(id);
    if (switching) {
      tierRef.current = null;
      seenActiveRef.current = null;
      setMessages([]);
    }
    if (!opts.quiet) setLoading(true);

    try {
      const result = await openChatOnServer(id);
      if (seq !== openSeqRef.current) return;
      tierRef.current = result.chat.tier;
      seenActiveRef.current = result.chat.lastActiveAt;
      let history = result.messages;
      if (result.runningJobId) {
        const stamp = Date.now();
        const assistantId = `a_${stamp}`;
        if (result.pendingPrompt) {
          history = [...history, { id: `u_${stamp}`, role: 'user', blocks: [{ kind: 'text', text: result.pendingPrompt }], done: true }];
        }
        history = [...history, { id: assistantId, role: 'assistant', blocks: [], done: false }];
        setMessages(history);
        attach({ jobId: result.runningJobId, assistantId, chatId: id });
      } else {
        setMessages(history);
      }
    } catch (err) {
      if (seq !== openSeqRef.current) return;
      if (err instanceof StepUpRequiredError) {
        setNeedsStepUp(true);
        setError('Biometric unlock required before SAM can run anything.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not open that chat.');
      }
    } finally {
      if (seq === openSeqRef.current) setLoading(false);
    }
  }, [attach, detach, stopSpeech]);

  /* ── The main list: picked from once on mount, then polled for titles, running markers and other devices' turns ── */

  const refreshChats = useCallback(async (): Promise<ChatSummary[] | null> => {
    try {
      const list = await listChats();
      setChats(list);
      setListLoaded(true);
      return list;
    } catch {
      setListLoaded(true);
      return null; // keep the last good list
    }
  }, []);

  useEffect(() => {
    if (demo) return;
    let alive = true;
    void refreshChats().then((list) => {
      if (!alive || !list || currentIdRef.current) return;
      const id = pickMostRecentChat(list);
      if (id) void openChatById(id);
    });
    return () => {
      alive = false;
    };
  }, [demo, refreshChats, openChatById]);

  useEffect(() => {
    if (demo) return;
    const poll = () => {
      setNow(Date.now());
      void refreshChats().then((list) => {
        const id = currentIdRef.current;
        if (!list || !id || runningRef.current || sendLockRef.current) return;
        const row = list.find((c) => c.id === id);
        if (!row) return;
        tierRef.current = row.tier;
        // A turn sent from another device or the Chat page: reload so this widget shows it (and attaches if it is still running).
        if ((seenActiveRef.current && row.lastActiveAt !== seenActiveRef.current) || row.running) {
          void openChatById(id, { quiet: true });
        }
      });
    };
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, LIST_POLL_MS);
    window.addEventListener('focus', poll);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', poll);
    };
  }, [demo, refreshChats, openChatById]);

  /* ── Focus heartbeat: this chat is on screen, so a turn ending here is not pushed as a notification ── */

  useEffect(() => {
    if (demo) return;
    if (tabIdRef.current === null) tabIdRef.current = tabId(sessionStorage);
    const report = () => {
      if (document.visibilityState === 'visible') sendFocus(currentIdRef.current, tabIdRef.current ?? '');
    };
    report();
    const interval = setInterval(report, FOCUS_BEAT_MS);
    return () => clearInterval(interval);
  }, [demo, currentId]);

  useEffect(() => {
    if (demo) return;
    const onVisibility = () => {
      if (tabIdRef.current === null) return;
      if (document.visibilityState === 'visible') {
        sendFocus(currentIdRef.current, tabIdRef.current);
        // Back from the background mid-turn: resume the stream from the last frame.
        const run = activeRunRef.current;
        if (run && runningRef.current) {
          retriesRef.current = 0;
          attachRef.current?.(run, parserRef.current !== null);
        }
      } else {
        sendFocus(null, tabIdRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (tabIdRef.current !== null) sendFocus(null, tabIdRef.current);
    };
  }, [demo]);

  /* ── Unmount: close the stream, stop this widget's speech, cancel a pending reconnect ── */

  useEffect(() => () => {
    streamRef.current?.close();
    speechRef.current?.stop();
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
  }, []);

  /* ── Keep the newest message in view, only while pinned to the bottom or right after a send (src/lib/chatFollow.ts) ── */

  const pinnedRef = useRef(true);
  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => { pinnedRef.current = true; }, [currentId]);
  useEffect(() => {
    const sent = newUserMessageId(messages, lastUserIdRef.current);
    if (sent) lastUserIdRef.current = sent;
    const el = msgsRef.current;
    if (el && shouldFollow(pinnedRef.current, sent !== null)) {
      el.scrollTop = el.scrollHeight;
      pinnedRef.current = true;
    }
  }, [messages, phase]);

  /* ── Send: the open chat, its own tier, the same endpoint as the Chat page ── */

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || runningRef.current || sendLockRef.current) return;
    sendLockRef.current = true;
    primeSpeech();
    try {
      // Device commands ("open Spotify") are resolved on the phone itself, exactly as on the Chat page.
      const osResult = await tryOsIntent(message);
      if (osResult.handled && osResult.reply) {
        const stamp = Date.now();
        setMessages((prev) => [
          ...prev,
          { id: `u_${stamp}`, role: 'user', blocks: [{ kind: 'text', text: message }], done: true },
          { id: `a_${stamp}`, role: 'assistant', blocks: [{ kind: 'text', text: osResult.reply! }], done: true },
        ]);
        setInput('');
        setError(null);
        if (handsFreeRef.current && !isMuted()) speakAnswer(osResult.reply);
        return;
      }

      // Read at call time: a hands-free transcript that lands after a switch goes to the chat now on screen.
      const startedFrom = currentIdRef.current;
      const tier: TierId = startedFrom ? sendTierFor(tierRef.current) : storedDraftTier();
      const stamp = Date.now();
      const assistantId = `a_${stamp}`;
      setMessages((prev) => [
        ...prev,
        { id: `u_${stamp}`, role: 'user', blocks: [{ kind: 'text', text: message }], done: true },
        { id: assistantId, role: 'assistant', blocks: [], done: false, tier },
      ]);
      setInput('');
      setError(null);
      setNeedsStepUp(false);
      runningRef.current = true;
      setRunning(true);
      setPhase('starting');

      try {
        const started = await startAgentTurn({ message, tier, chatId: startedFrom ?? undefined });
        if (currentIdRef.current !== startedFrom) return; // switched away; the turn runs on in its own chat
        if (!startedFrom) {
          currentIdRef.current = started.chatId;
          setCurrentId(started.chatId);
          tierRef.current = started.tier.id;
        }
        void refreshChats();
        if (handsFreeRef.current && !isMuted()) {
          // The spoken ack covers the boot gap, as on the Chat page (hands-free only here).
          speakChunked('On it', { voice: parseInt(localStorage.getItem('sam-tts-voice') ?? '21', 10) });
        }
        attach({ jobId: started.jobId, assistantId, chatId: started.chatId });
      } catch (err) {
        if (currentIdRef.current !== startedFrom) return;
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        runningRef.current = false;
        setRunning(false);
        setPhase('done');
        if (err instanceof StepUpRequiredError) {
          setNeedsStepUp(true);
          setError('Biometric unlock required before SAM can run anything.');
        } else {
          setError(err instanceof Error ? err.message : 'Chat failed');
        }
      }
    } finally {
      sendLockRef.current = false;
    }
  }, [attach, refreshChats, speakAnswer]);

  /* ── Hands-free: the mic button, or a "Hey Sam" handed over by FleetView ── */

  const startHandsFree = useCallback(() => {
    setHandsFree(true);
    setHandsFreeFailed(null);
  }, []);

  useEffect(() => {
    if (!wakeToken) return;
    if (!demo) startHandsFree();
    onWakeHandled?.();
  }, [wakeToken, demo, startHandsFree, onWakeHandled]);

  const onHandsFreeTranscribe = useCallback((text: string) => {
    primeSpeech();
    void send(text);
  }, [send]);
  const onHandsFreeCancel = useCallback(() => {
    setHandsFree(false);
    setHandsFreeFailed(null);
  }, []);
  const onHandsFreeFallback = useCallback((message: string) => setHandsFreeFailed(message), []);

  /* ── The picker ── */

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.querySelector('.dcw-menu')?.contains(e.target as Node)
        && !rootRef.current.querySelector('.dcw-pick')?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pickerOpen]);

  const rows = useMemo(() => pickerChats(chats, query), [chats, query]);
  const current = chats.find((c) => c.id === currentId) ?? null;
  const pickChat = (id: string) => {
    setPickerOpen(false);
    setQuery('');
    if (id !== currentIdRef.current) void openChatById(id);
  };

  const shown = messages.slice(-SHOWN_MESSAGES);

  if (demo) {
    return (
      <section ref={rootRef} className="dcw" data-variant={variant} aria-label="Chat with SAM">
        <style>{CSS}</style>
        <header className="dcw-ph">
          <span className="dcw-pt">Chat with SAM</span>
        </header>
        <p className="dcw-note">Chat is hidden in demo mode.</p>
      </section>
    );
  }

  return (
    <section ref={rootRef} className="dcw" data-variant={variant} aria-label="Chat with SAM" data-chat-id={currentId ?? undefined}>
      <style>{CSS}</style>

      <header className="dcw-ph">
        <span className="dcw-pt">Chat with SAM</span>
        {chats.length > 0 ? (
          <button
            type="button"
            className="dcw-pick"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label="Switch chat"
            title={current?.title}
            onClick={() => setPickerOpen((o) => !o)}
          >
            {current?.running ? <i aria-hidden /> : null}
            <span>{current?.title ?? 'Pick a chat'}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
        ) : null}
      </header>

      {pickerOpen ? (
        <div
          className="dcw-menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setPickerOpen(false);
            }
          }}
        >
          <input
            type="search"
            value={query}
            placeholder="Find a chat…"
            aria-label="Find a chat by title"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {rows.length ? (
            <ul role="listbox" aria-label="Chats">
              {rows.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={c.id === currentId} aria-current={c.id === currentId} onClick={() => pickChat(c.id)}>
                    {c.running ? <i aria-label="Running" /> : null}
                    <b>{c.title}</b>
                    <small>{formatRelative(c.lastActiveAt, now)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No chat title matches.</p>
          )}
        </div>
      ) : null}

      <div
        className="dcw-msgs"
        ref={msgsRef}
        aria-live="polite"
        onScroll={(e) => { pinnedRef.current = isNearBottom(e.currentTarget); }}
      >
        {loading && shown.length === 0 ? <p className="dcw-note">Loading the chat…</p> : null}
        {!loading && listLoaded && !currentId && shown.length === 0 ? (
          <p className="dcw-note">No chats yet. Ask SAM anything to start one.</p>
        ) : null}
        {shown.map((m) => {
          const line = messageLine(m);
          const isErr = m.role === 'assistant' && m.blocks.length > 0 && m.blocks.every((b) => b.kind === 'error');
          if (m.role === 'assistant' && !m.done && !line) {
            return (
              <div key={m.id} className="dcw-msg sam">
                <b>SAM</b>
                <em>{PHASE_LABEL[phase] || 'Working'}…</em>
              </div>
            );
          }
          if (!line) return null;
          return (
            <div key={m.id} className={`dcw-msg ${m.role === 'user' ? 'you' : 'sam'}${isErr ? ' err' : ''}`}>
              <b>{m.role === 'user' ? 'You' : 'SAM'}</b>
              {line}
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="dcw-err" role="alert">
          {error}
          {needsStepUp ? <a href={currentId ? `/chat?c=${encodeURIComponent(currentId)}` : '/chat'}>Unlock in Chat</a> : null}
        </p>
      ) : null}

      {handsFree ? (
        <div className="dcw-voice">
          {!handsFreeFailed ? (
            <HandsFreeMic
              enabled={handsFree}
              working={running}
              speaking={speaking}
              onTranscribe={onHandsFreeTranscribe}
              onCancel={onHandsFreeCancel}
              onFallback={onHandsFreeFallback}
            />
          ) : (
            <>
              <p className="dcw-note">
                Woken by voice — hold the mic to speak. <button type="button" onClick={onHandsFreeCancel}>Stop</button>
              </p>
              <VoiceRecordButton onTranscribe={onHandsFreeTranscribe} />
            </>
          )}
        </div>
      ) : null}

      <form
        className="dcw-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={running ? 'SAM is on it…' : 'Ask SAM…'}
          aria-label="Message SAM"
          enterKeyHint="send"
        />
        <button
          type="button"
          aria-label={handsFree ? 'Stop hands-free' : 'Talk to SAM hands-free'}
          aria-pressed={handsFree}
          title={handsFree ? 'Stop hands-free' : 'Talk hands-free'}
          onClick={() => {
            primeSpeech();
            if (handsFree) onHandsFreeCancel();
            else startHandsFree();
          }}
        >
          <Mic size={14} aria-hidden />
        </button>
        <button type="submit" aria-label="Send" disabled={running || !input.trim()}>
          <Send size={14} aria-hidden />
        </button>
      </form>

      <div className="dcw-foot">
        <span>{running ? `${PHASE_LABEL[phase] || 'Working'}…` : ''}</span>
        <a href={currentId ? `/chat?c=${encodeURIComponent(currentId)}` : '/chat'}>Open in Chat</a>
      </div>
    </section>
  );
}
