/**
 * Practice — rehearsal against a persona, by voice.
 *
 * The same practice agent the desktop runs, driven from the phone. A brief is
 * loaded once (it *is* the first message of the session), then each turn is a
 * resumed CLI session with no tools, the practice project's settings, and the
 * roleplay discipline as the system prompt. See /api/practice/turn.
 *
 * Two things here are not like the chat page and are deliberate:
 *
 *   - The buyer's voice is fixed, not the operator's chat preference. Ryan at
 *     natural pace, because a rushed read is most of what makes a voice sound
 *     like a machine reading a script, and the character is a person.
 *   - The buyer's reply is spoken a sentence at a time as it is generated, not
 *     once it has finished. The desktop practice agent does the same, and it is
 *     the difference between a conversation and a walkie-talkie.
 *
 * The mic stays shut until the brief has finished loading: a turn that resumed
 * the session file while the load was still writing would race it.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Square, Users } from 'lucide-react';

import { HandsFreeMic } from '@/components/voice/HandsFreeMic';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { jobsService } from '@/lib/jobsService';
import { PracticeStream } from '@/lib/practiceStream';
import { listBriefs, sendTurn, startSession } from '@/lib/practiceService';
import { isSpeechBlocked, primeSpeech, speakChunked, stopAllSpeech, type SpeechHandle } from '@/lib/speech';
import type { PracticeBrief, PracticeLine, PracticeTurnResult } from '@/types/practice';

/**
 * The buyer's voice. en-GB-RyanNeural at +0% — the desktop practice agent's
 * choice, and emphatically not SAM's Abeo at +15%.
 */
const BUYER_EDGE_VOICE = 'en-GB-RyanNeural';
const BUYER_EDGE_RATE = '+0%';
/**
 * Kokoro fallback index used when voice-line is unreachable. It is the wrong
 * voice for the character, but a buyer who sounds like someone else is a better
 * rehearsal than a buyer who says nothing.
 */
const BUYER_FALLBACK_VOICE = 7;

type Turn = 'idle' | 'loading-brief' | 'thinking' | 'speaking';

/** The word that breaks the character and asks for the critique. */
const DEBRIEF_WORD = 'debrief';

export default function PracticePage() {
  const [briefs, setBriefs] = useState<PracticeBrief[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [brief, setBrief] = useState<PracticeBrief | null>(null);
  const [lines, setLines] = useState<PracticeLine[]>([]);
  const [turn, setTurn] = useState<Turn>('idle');
  const [error, setError] = useState<string | null>(null);
  const [handsfree, setHandsfree] = useState(true);
  const [typed, setTyped] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);

  const streamRef = useRef<{ close(): void } | null>(null);
  const speechRef = useRef<SpeechHandle | null>(null);
  /** Mirrors of the state the async stream callbacks need to read. */
  const sessionRef = useRef<string | null>(null);
  const briefRef = useRef<PracticeBrief | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  /* ── The brief list ──────────────────────────────────────────────────── */

  useEffect(() => {
    const controller = new AbortController();
    listBriefs(controller.signal)
      .then(setBriefs)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setListError(err instanceof Error ? err.message : 'Could not load briefs.');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // A rehearsal left mid-turn when the tab unmounts would keep its CLI process
  // and its voice running with no UI to stop them.
  useEffect(
    () => () => {
      streamRef.current?.close();
      stopAllSpeech();
    },
    [],
  );

  /* ── Speaking ─────────────────────────────────────────────────────────── */

  const speak = useCallback((text: string) => {
    if (!text.trim()) return;
    setTurn('speaking');
    const handle = speakChunked(text, {
      voice: BUYER_FALLBACK_VOICE,
      edgeVoice: BUYER_EDGE_VOICE,
      edgeRate: BUYER_EDGE_RATE,
    });
    speechRef.current = handle;
    void handle.done.then(() => {
      if (speechRef.current !== handle) return;
      speechRef.current = null;
      setAudioBlocked(isSpeechBlocked());
      // Only the newest handle may re-open the mic: an earlier sentence's
      // completion must not do it while the last one is still playing.
      setTurn((current) => (current === 'speaking' ? 'idle' : current));
    });
  }, []);

  /* ── Transcript helpers ──────────────────────────────────────────────── */

  /** Append to the in-flight buyer line, or start one. */
  const pushBuyer = useCallback((text: string) => {
    if (!text.trim()) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'buyer' && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
      }
      return [...prev, { role: 'buyer', text, streaming: true }];
    });
  }, []);

  const sealBuyer = useCallback(() => {
    setLines((prev) =>
      prev.map((line) => (line.streaming ? { ...line, streaming: false } : line)),
    );
  }, []);

  const note = useCallback((text: string) => {
    setLines((prev) => [...prev, { role: 'note', text }]);
  }, []);

  /* ── Opening a session ───────────────────────────────────────────────── */

  const openSession = useCallback(
    async (selected: PracticeBrief) => {
      streamRef.current?.close();
      streamRef.current = null;
      stopAllSpeech();
      setError(null);
      setLines([]);
      setBrief(selected);
      briefRef.current = selected;
      sessionRef.current = null;
      setTurn('loading-brief');

      let started: PracticeTurnResult;
      try {
        started = await startSession(selected.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the rehearsal.');
        setBrief(null);
        briefRef.current = null;
        setTurn('idle');
        return;
      }

      sessionRef.current = started.sessionId;
      note(`${started.speaker || selected.speaker} is on the line`);
      // The scenario's own opening line is spoken by us, not generated — the
      // model's "ready" is never heard. Same as the desktop.
      if (started.openingLine) pushBuyer(started.openingLine);
      sealBuyer();

      // The brief-load job's output is discarded; only its ending matters,
      // because that is when the session is on disk and safe to resume.
      streamRef.current = jobsService.stream(started.jobId, (event) => {
        if (event.type !== 'closed') return;
        streamRef.current?.close();
        streamRef.current = null;
        setTurn('idle');
        if (started.openingLine) speak(started.openingLine);
      });
    },
    [note, pushBuyer, sealBuyer, speak],
  );

  /* ── One turn ────────────────────────────────────────────────────────── */

  const say = useCallback(
    async (message: string) => {
      const sessionId = sessionRef.current;
      const current = briefRef.current;
      if (!sessionId || !current || !message.trim()) return;

      streamRef.current?.close();
      streamRef.current = null;
      stopAllSpeech();
      setError(null);
      setLines((prev) => [...prev, { role: 'colin', text: message.trim() }]);
      setTurn('thinking');

      let started: PracticeTurnResult;
      try {
        started = await sendTurn(sessionId, current.id, message.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That turn did not send.');
        note('the turn did not send');
        sealBuyer();
        setTurn('idle');
        return;
      }

      const reader = new PracticeStream();
      streamRef.current = jobsService.stream(started.jobId, (event) => {
        if (event.type === 'output') {
          // Spoken as it arrives: the first sentence plays while the rest of
          // the reply is still being written.
          const ready = reader.push(event.text);
          if (ready) {
            pushBuyer(ready);
            speak(ready);
          }
          return;
        }

        if (event.type !== 'closed') return;
        streamRef.current?.close();
        streamRef.current = null;

        const tail = reader.flush();
        if (tail) {
          pushBuyer(tail);
          speak(tail);
        }
        sealBuyer();
        // A turn that produced no words at all still has to release the mic,
        // or the rehearsal looks like it has hung.
        if (event.status !== 'exited') {
          note(`the turn ended early (${event.status})`);
        }
        setTurn((prevTurn) => (prevTurn === 'thinking' ? 'idle' : prevTurn));
      });
    },
    [note, pushBuyer, sealBuyer, speak],
  );

  const endSession = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    stopAllSpeech();
    setBrief(null);
    briefRef.current = null;
    sessionRef.current = null;
    setLines([]);
    setTurn('idle');
    setError(null);
  }, []);

  const busy = turn === 'loading-brief' || turn === 'thinking';

  /* ── Picker ──────────────────────────────────────────────────────────── */

  if (!brief) {
    return (
      <div className="sam-practice-root flex flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2 border-b border-void-800 bg-void-900/85 backdrop-blur-md shrink-0">
          <Users size={16} className="text-accent" />
          <h1 className="text-sm font-semibold">Practice</h1>
          <span className="text-[11px] text-void-300 ml-auto">Rehearse the other side</span>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
          {listError && (
            <p className="text-xs text-amber-300 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {listError}
            </p>
          )}

          {!briefs && !listError && <p className="text-xs text-void-300">Loading briefs…</p>}

          {briefs?.length === 0 && (
            <p className="text-xs text-void-300">
              No briefs found in the practice project&rsquo;s briefs folder.
            </p>
          )}

          {briefs?.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                // A real gesture: this is where the audio element gets unlocked.
                primeSpeech();
                void openSession(item);
              }}
              className="w-full text-left rounded-lg border border-void-700 bg-void-900/60
                         hover:border-accent/50 active:border-accent transition-colors p-3"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-[11px] text-accent mt-0.5">{item.speaker}</p>
                </div>
                {item.realLead && (
                  <span
                    className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-amber-700/50
                               text-amber-300 bg-amber-900/20"
                    title="Built from a real lead's own words, not a composite"
                  >
                    REAL LEAD
                  </span>
                )}
              </div>
              {item.openingLine && (
                <p className="text-[11px] text-void-300 mt-2 line-clamp-2 italic">
                  &ldquo;{item.openingLine}&rdquo;
                </p>
              )}
            </button>
          ))}

          <p className="text-[10px] text-void-400 pt-2 leading-relaxed">
            The buyer will not fold because you made a good point. Say
            &ldquo;{DEBRIEF_WORD}&rdquo; at any time for a blunt critique of how it went.
          </p>
        </div>
      </div>
    );
  }

  /* ── In session ──────────────────────────────────────────────────────── */

  return (
    <div className="sam-practice-root flex flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2 border-b border-void-800 bg-void-900/85 backdrop-blur-md shrink-0">
        <button
          type="button"
          onClick={endSession}
          className="text-xs px-2 py-1 rounded border border-void-700 text-void-200 hover:border-void-500 transition-colors shrink-0"
        >
          End
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">{brief.speaker}</p>
          <p className="text-[10px] text-void-300 truncate">{brief.title}</p>
        </div>
        {turn === 'loading-brief' && (
          <span className="text-[10px] text-accent shrink-0">getting into character…</span>
        )}
        {turn === 'thinking' && <span className="text-[10px] text-void-300 shrink-0">thinking…</span>}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {lines.map((line, index) => {
          if (line.role === 'note') {
            return (
              <p key={index} className="text-[10px] text-void-400 text-center py-1">
                {line.text}
              </p>
            );
          }
          const mine = line.role === 'colin';
          return (
            <div key={index} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-snug ${
                  mine
                    ? 'bg-accent/15 border border-accent/30 text-void-100'
                    : 'bg-void-800/80 border border-void-700 text-void-100'
                }`}
              >
                {!mine && (
                  <p className="text-[10px] text-accent mb-0.5">{brief.speaker}</p>
                )}
                {line.text}
              </div>
            </div>
          );
        })}
        {error && (
          <p className="text-xs text-amber-300 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Controls */}
      <div className="shrink-0 border-t border-void-800 bg-void-900/85 backdrop-blur-md px-3 py-2 space-y-2">
        {audioBlocked && (
          <button
            type="button"
            onClick={() => {
              primeSpeech();
              setAudioBlocked(false);
            }}
            className="w-full text-xs px-3 py-1.5 rounded border border-amber-700/50 text-amber-300 bg-amber-900/20"
          >
            Tap to enable audio
          </button>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void say(DEBRIEF_WORD)}
            disabled={busy || turn === 'speaking'}
            className="text-xs px-3 py-2 rounded border border-void-700 text-void-100
                       hover:border-accent/50 disabled:opacity-40 transition-colors shrink-0"
          >
            Debrief
          </button>

          <div className="flex-1 min-w-0 flex items-center justify-center">
            {handsfree ? (
              <HandsFreeMic
                enabled
                working={busy}
                speaking={turn === 'speaking'}
                onTranscribe={(text) => void say(text)}
                onCancel={endSession}
                onFallback={(message) => {
                  setHandsfree(false);
                  if (message) note(message);
                }}
              />
            ) : (
              <VoiceRecordButton onTranscribe={(text) => void say(text)} />
            )}
          </div>

          <button
            type="button"
            onClick={endSession}
            title="End the rehearsal"
            className="text-xs px-3 py-2 rounded border border-void-700 text-void-100
                       hover:border-void-500 transition-colors shrink-0"
          >
            <Square size={14} />
          </button>
        </div>

        {/* Typed turn — for when talking out loud is not an option. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const message = typed.trim();
            if (!message) return;
            primeSpeech();
            setTyped('');
            void say(message);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Or type your line…"
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border border-void-700
                       bg-void-950/60 placeholder:text-void-400 focus:border-accent/60 outline-none"
          />
          <button
            type="submit"
            disabled={busy || !typed.trim()}
            className="text-xs px-3 py-1.5 rounded border border-void-700 text-void-100
                       disabled:opacity-40 transition-colors shrink-0"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
