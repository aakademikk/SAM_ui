/**
 * HandsFreeMic — the zero-touch side of the Omni loop.
 *
 * Woken by the Android service as /chat?wake=1, this acquires the mic without
 * a tap, listens for speech, transcribes on silence, sends the transcript and
 * re-arms ~5 s after the spoken reply so the next thing Colin says is heard
 * too. Tap the stop button to end the session — that hands control back to the
 * hold-to-record button.
 *
 * If the mic cannot be acquired without a gesture (desktop Chrome with no
 * pre-granted permission), `onFallback` fires and the page swaps in
 * VoiceRecordButton, which acquires on a real tap.
 *
 * Loop lifecycle: one rAF chain runs while the external gates are open (mic
 * acquired, no turn in flight, re-arm pause elapsed) AND the status is ready or
 * recording. It survives the ready→recording transition — starting an
 * utterance must not tear the loop down — and only stops when a gate closes
 * (a turn starts, the session is cancelled) or while a transcript is being
 * sent, at which point the status flip back to ready restarts it.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MicOff } from 'lucide-react';
import {
  acquireMicStream,
  micErrorMessage,
  pickRecordingMime,
  type MicStream,
} from '@/lib/micStream';
import { transcribeAudio } from '@/lib/voiceService';

/* ========================================================================== */
/* Constants                                                                   */
/* ========================================================================== */

/** Pause after a spoken reply before the mic listens again. */
const REARM_DELAY_MS = 5000;
/** Continuous voice above threshold before an utterance is started. */
const SPEECH_START_MS = 250;
/** Continuous silence below threshold before the utterance ends. */
const SILENCE_END_MS = 1100;
/** Hard cap on one utterance — same as the hold-to-record button. */
const MAX_UTTERANCE_MS = 30_000;
/** Blips below this are discarded. */
const MIN_UTTERANCE_MS = 300;
/** RMS above this counts as speech. */
const VOICE_THRESHOLD = 0.02;
/**
 * Minimum gap after a transcript is sent before a new utterance may start.
 * Residual audio from the sentence just spoken could otherwise re-trigger the
 * mic. The page's send-lock is the real double-fire guard; this is the UX gap.
 */
const MIN_TURN_GAP_MS = 800;

/* ========================================================================== */
/* Types                                                                       */
/* ========================================================================== */

type MicStatus = 'acquiring' | 'ready' | 'recording' | 'processing' | 'failed';

interface HandsFreeMicProps {
  enabled: boolean;
  working: boolean;
  speaking: boolean;
  onTranscribe: (text: string) => void;
  onCancel: () => void;
  onFallback: (message: string) => void;
}

/* ========================================================================== */
/* Component                                                                   */
/* ========================================================================== */

export function HandsFreeMic({
  enabled,
  working,
  speaking,
  onTranscribe,
  onCancel,
  onFallback,
}: HandsFreeMicProps) {
  const [status, setStatus] = useState<MicStatus>('acquiring');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rearmReady, setRearmReady] = useState(true);

  const micRef = useRef<MicStream | null>(null);
  const timeBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const recordingRef = useRef(false);
  const transcribingRef = useRef(false);
  const utterStartedAtRef = useRef(0);
  const utterSinceRef = useRef(0);
  const silentSinceRef = useRef(0);
  const lastTickRef = useRef(0);
  const lastSendAtRef = useRef(0);
  const prevSpeakingRef = useRef(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Acquire the mic on mount (no gesture — permission is pre-granted on
        the TWA; anywhere else this is where the fallback happens) ──────── */

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let mic: MicStream | null = null;
    setStatus('acquiring');

    (async () => {
      try {
        mic = await acquireMicStream();
        if (disposed) { mic.close(); return; }
        micRef.current = mic;
        timeBufRef.current = new Uint8Array(mic.analyser.fftSize);
        console.log('[SAM] Hands-free mic acquired');
        setStatus('ready');
      } catch (err) {
        console.error('[SAM] Hands-free mic failed:', err);
        if (disposed) return;
        setStatus('failed');
        onFallback(micErrorMessage(err));
      }
    })();

    return () => {
      disposed = true;
      mic?.close();
      micRef.current = null;
      // Unmounting mid-transcription must not send what was never finished
      // hearing. This also covers the cancel path.
      cancelledRef.current = true;
    };
  }, [enabled, onFallback]);

  /* ── Re-arm: pause ~5 s after a spoken reply before listening again ───── */

  useEffect(() => {
    const finished = prevSpeakingRef.current && !speaking;
    prevSpeakingRef.current = speaking;
    if (!finished) return;

    setRearmReady(false);
    const t = setTimeout(() => setRearmReady(true), REARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [speaking]);

  /* ── Transient error toast — clears so the loop keeps going ───────────── */

  const flashError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 4000);
  }, []);

  useEffect(() => () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, []);

  /* ── Utterance lifecycle ──────────────────────────────────────────────── */

  const endUtterance = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const startUtterance = useCallback(() => {
    const mic = micRef.current;
    if (!mic || recordingRef.current) return;

    cancelledRef.current = false;
    chunksRef.current = [];
    recordingRef.current = true;
    utterStartedAtRef.current = performance.now();

    const mimeType = pickRecordingMime();
    const recorder = new MediaRecorder(mic.stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      recordingRef.current = false;
      recorderRef.current = null;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const duration = performance.now() - utterStartedAtRef.current;

      if (cancelledRef.current || duration < MIN_UTTERANCE_MS) {
        setStatus('ready');
        return;
      }

      transcribingRef.current = true;
      setStatus('processing');
      void transcribeAudio(blob)
        .then((result) => {
          transcribingRef.current = false;
          if (cancelledRef.current) return;
          if (result.transcript.trim()) {
            setStatus('ready');
            lastSendAtRef.current = performance.now();
            onTranscribe(result.transcript.trim());
          } else {
            flashError('No speech detected. Try again.');
            setStatus('ready');
          }
        })
        .catch((err) => {
          transcribingRef.current = false;
          if (cancelledRef.current) return;
          console.error('[SAM] Transcription error:', err);
          flashError(err instanceof Error ? err.message : 'Transcription failed');
          setStatus('ready');
        });
    };

    recorder.start(100);
    setStatus('recording');
  }, [onTranscribe, flashError]);

  /* ── Voice-activity detection loop ────────────────────────────────────── */

  // The loop stays live through ready AND recording; only the external gates
  // (a turn in flight, the re-arm pause, no mic) or an in-flight transcription
  // tear it down. Tearing it down on ready→recording would discard the very
  // utterance it just started.
  const loopActive =
    enabled
    && !working
    && !speaking
    && rearmReady
    && (status === 'ready' || status === 'recording');

  useEffect(() => {
    if (!loopActive) return;
    const mic = micRef.current;
    if (!mic) return;

    utterSinceRef.current = 0;
    silentSinceRef.current = 0;
    lastTickRef.current = performance.now();

    const loop = () => {
      const current = micRef.current;
      if (!current) { rafRef.current = requestAnimationFrame(loop); return; }

      const buf = timeBufRef.current;
      if (buf) current.analyser.getByteTimeDomainData(buf);

      // RMS of the time-domain signal — cheap and robust against tone levels.
      let sum = 0;
      if (buf) {
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
      }
      const rms = Math.sqrt(sum / (buf?.length ?? 1));

      // Diagnostic only — deliberately NOT React state. An earlier attempt set
      // state here at 5/s and the hands-free path stopped working; whatever the
      // mechanism, instrumentation must not be able to change behaviour. Read
      // it from the browser console as `__vad`.
      (window as unknown as { __vad?: unknown }).__vad = {
        rms: Number(rms.toFixed(4)),
        threshold: VOICE_THRESHOLD,
        recording: recordingRef.current,
        speechMs: Math.round(utterSinceRef.current),
        silentMs: Math.round(silentSinceRef.current),
      };
      // Only the recording dot needs the live level — updating React state
      // every idle frame would re-render the composer 60×/s for nothing.
      if (recordingRef.current) setLevel(rms);

      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;

      if (recordingRef.current) {
        if (rms > VOICE_THRESHOLD) silentSinceRef.current = 0;
        else silentSinceRef.current += dt;

        if (now - utterStartedAtRef.current >= MAX_UTTERANCE_MS
          || silentSinceRef.current >= SILENCE_END_MS) {
          // Transcription runs on recorder.onstop; status flips to
          // 'processing', which drops loopActive and re-enters this effect
          // when it flips back to 'ready'.
          endUtterance();
        }
      } else if (!transcribingRef.current && rms > VOICE_THRESHOLD) {
        utterSinceRef.current += dt;
        if (utterSinceRef.current >= SPEECH_START_MS
          && now - lastSendAtRef.current >= MIN_TURN_GAP_MS) {
          startUtterance();
        }
      } else {
        utterSinceRef.current = 0;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      // Only discard when a recording is actually being cut short (a turn
      // started, the session was cancelled) — never on the normal
      // recording→processing transition, where recordingRef is already false
      // and the transcript is being finished legitimately.
      if (recordingRef.current && recorderRef.current?.state === 'recording') {
        cancelledRef.current = true;
        recorderRef.current.stop();
      }
    };
  }, [loopActive, startUtterance, endUtterance]);

  /* ── Render ───────────────────────────────────────────────────────────── */

  const pill = (() => {
    if (status === 'acquiring') {
      return { text: 'Enabling microphone…', cls: 'bg-amber-900/30 border-amber-500/30 text-amber-400', dot: 'bg-amber-400 animate-pulse', pulse: false };
    }
    if (status === 'processing') {
      return { text: 'Transcribing…', cls: 'bg-amber-900/30 border-amber-500/30 text-amber-400', dot: 'bg-amber-400 animate-pulse', pulse: false };
    }
    if (working) {
      return { text: 'SAM is working…', cls: 'bg-void-800 border-void-600 text-dim-300', dot: 'bg-accent animate-pulse', pulse: false };
    }
    if (speaking) {
      return { text: 'SAM is speaking…', cls: 'bg-void-800 border-void-600 text-dim-300', dot: 'bg-accent animate-pulse', pulse: false };
    }
    if (status === 'recording') {
      return { text: 'Listening — speak', cls: 'bg-red-900/40 border-red-500/40 text-red-400', dot: 'bg-red-400', pulse: true };
    }
    if (!rearmReady) {
      return { text: 'Listening again shortly…', cls: 'bg-void-800 border-void-600 text-dim-300', dot: 'bg-accent animate-pulse', pulse: false };
    }
    return { text: 'Listening — speak', cls: 'bg-accent/20 border-accent/40 text-accent', dot: 'bg-accent', pulse: false };
  })();

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm ${pill.cls}`}>
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${pill.dot}`}
            style={pill.pulse ? { opacity: 0.6 + level * 0.4 } : undefined}
          />
          <span>{pill.text}</span>
        </div>

        <button
          type="button"
          onClick={onCancel}
          title="Stop hands-free"
          aria-label="Stop hands-free"
          className="p-2.5 rounded-full border border-void-600 bg-void-800
                     text-dim-300 hover:text-red-400 hover:border-red-700/40
                     transition-colors"
        >
          <MicOff size={16} />
        </button>
      </div>

      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
