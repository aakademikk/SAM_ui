/**
 * VoiceRecordButton — hold-to-record with slide-to-cancel.
 *
 * Acquires the mic stream once on mount and keeps it open. Recording
 * starts on pointerdown and stops on pointerup. Slide left to cancel.
 * Transcript appears in a confirm step — nothing executes automatically.
 *
 * Android-specific: touch-action:none, user-select:none, -webkit-touch-callout:none
 * to prevent long-press text selection on the record button.
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Mic, Send, X, ArrowLeft } from 'lucide-react';
import { transcribeAudio } from '@/lib/voiceService';

/* ========================================================================== */
/* Types                                                                       */
/* ========================================================================== */

type RecordState = 'idle' | 'recording' | 'processing' | 'confirm';

/* ========================================================================== */
/* Constants                                                                   */
/* ========================================================================== */

const MIN_RECORD_MS = 300;
const MAX_RECORD_MS = 30_000;
const CANCEL_SLIDE_PX = 60;

/* ========================================================================== */
/* Component                                                                   */
/* ========================================================================== */

interface VoiceRecordButtonProps {
  /** Called when the user confirms and wants to execute the transcript. */
  onTranscribe: (text: string) => void;
}

export function VoiceRecordButton({ onTranscribe }: VoiceRecordButtonProps) {
  const [state, setState] = useState<RecordState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [slideOffset, setSlideOffset] = useState(0);
  const [recordTime, setRecordTime] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number>(0);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Acquire mic stream once on mount ────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    const acquire = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Set up an analyser for live audio level.
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioContextRef.current = ctx;
          analyserRef.current = analyser;
        } catch {
          // AudioContext may fail in some contexts — non-critical.
        }
      } catch {
        if (!cancelled) {
          setError('Microphone access denied. Check your browser permissions.');
        }
      }
    };

    acquire();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ── Audio level meter ───────────────────────────────────────────────── */

  const startLevelMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const sum = data.reduce((a, b) => a + b, 0);
      const avg = sum / data.length;
      setAudioLevel(Math.min(1, avg / 128));
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = 0;
    }
    setAudioLevel(0);
  }, []);

  /* ── Recording lifecycle ─────────────────────────────────────────────── */

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setError('No microphone available. Reload the page.');
      return;
    }

    cancelledRef.current = false;
    chunksRef.current = [];
    setSlideOffset(0);
    setRecordTime(0);
    setTranscript('');
    setError(null);

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      stopLevelMeter();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

      if (cancelledRef.current || recordTime * 1000 < MIN_RECORD_MS) {
        setState('idle');
        return;
      }

      setState('processing');
      try {
        const result = await transcribeAudio(blob);
        if (!result.transcript) {
          setError('No speech detected. Try again.');
          setState('idle');
        } else {
          setTranscript(result.transcript);
          setState('confirm');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed');
        setState('idle');
      }
    };

    recorder.start(100); // collect data every 100ms
    setState('recording');
    startLevelMeter();

    timerRef.current = setInterval(() => {
      setRecordTime((prev) => {
        if (prev >= MAX_RECORD_MS / 1000) {
          stopRecording();
          return prev;
        }
        return prev + 0.1;
      });
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLevelMeter, stopLevelMeter]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  /* ── Pointer event handlers ──────────────────────────────────────────── */

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Use ref to avoid stale closure over state.
    if (recorderRef.current?.state === 'recording') return;
    if (e.currentTarget instanceof HTMLButtonElement && e.currentTarget.disabled) return;

    startPosRef.current = { x: e.clientX, y: e.clientY };
    startRecording();
  }, [startRecording]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (state !== 'recording' || !startPosRef.current) return;

    const dx = startPosRef.current.x - e.clientX; // positive = left swipe
    setSlideOffset(Math.max(0, dx));

    if (dx > CANCEL_SLIDE_PX) {
      cancelledRef.current = true;
      setState('idle');
      stopRecording();
      stopLevelMeter();
      setSlideOffset(0);
      startPosRef.current = null;
    }
  }, [state, stopRecording, stopLevelMeter]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    startPosRef.current = null;

    if (state === 'recording') {
      stopRecording();
    }
  }, [state, stopRecording]);

  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
    setState('idle');
    stopRecording();
    stopLevelMeter();
    startPosRef.current = null;
  }, [stopRecording, stopLevelMeter]);

  /* ── Confirm / dismiss ───────────────────────────────────────────────── */

  const onConfirm = useCallback(() => {
    if (transcript.trim()) {
      onTranscribe(transcript.trim());
    }
    setState('idle');
    setTranscript('');
    setError(null);
  }, [transcript, onTranscribe]);

  const onDismiss = useCallback(() => {
    setState('idle');
    setTranscript('');
    setError(null);
  }, []);

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (state === 'confirm') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <textarea
            className="flex-1 bg-void-900 border border-accent/30 rounded-lg px-3 py-2
                       text-void-100 text-sm font-mono resize-none focus:border-accent
                       focus:outline-none min-h-[3rem]"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={onConfirm}
              className="p-2 bg-accent/20 border border-accent/40 rounded-lg
                         text-accent hover:bg-accent/30 transition-colors"
            >
              <Send size={16} />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="p-2 bg-void-800 border border-void-600 rounded-lg
                         text-void-400 hover:text-void-200 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-2 px-4 py-2.5 bg-void-800 border border-void-600
                   rounded-full text-void-400 text-sm"
        style={{ touchAction: 'none' }}
      >
        <span className="inline-block w-3 h-3 rounded-full bg-accent animate-pulse" />
        Transcribing...
      </button>
    );
  }

  const isRecording = state === 'recording';
  const cancelOpacity = Math.max(0, 1 - slideOffset / CANCEL_SLIDE_PX);

  return (
    <div className="relative flex items-center gap-3">
      {/* Slide-to-cancel indicator (appears when recording) */}
      {isRecording && (
        <div
          className="flex items-center gap-1 text-amber-400 text-xs font-medium transition-opacity"
          style={{ opacity: slideOffset > 10 ? 1 : 0 }}
        >
          <ArrowLeft size={14} />
          <span>Slide to cancel</span>
        </div>
      )}

      {/* Record button */}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`
          relative flex items-center justify-center gap-2 px-5 py-2.5
          rounded-full border text-sm font-medium transition-all select-none
          ${isRecording
            ? 'bg-red-900/40 border-red-500/40 text-red-400 scale-110'
            : 'bg-accent/20 border-accent/40 text-accent hover:bg-accent/30 active:scale-95'
          }
        `}
        style={{
          touchAction: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          transform: isRecording ? `scale(1.1) translateX(${-slideOffset}px)` : undefined,
          opacity: isRecording ? cancelOpacity : 1,
        }}
      >
        {isRecording ? (
          <>
            <span
              className="inline-block w-2.5 h-2.5 rounded-full bg-red-400"
              style={{ opacity: 0.6 + audioLevel * 0.4 }}
            />
            <span>{recordTime.toFixed(1)}s</span>
          </>
        ) : (
          <>
            <Mic size={16} />
            <span>Hold to record</span>
          </>
        )}
      </button>

      {/* Audio level meter bar */}
      {isRecording && (
        <div className="flex items-end gap-0.5 h-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="w-1 rounded-full bg-accent transition-all duration-75"
              style={{
                height: `${Math.min(100, audioLevel * 100 * (0.5 + Math.random() * 0.5))}%`,
                opacity: 0.3 + audioLevel * 0.7,
              }}
            />
          ))}
        </div>
      )}

      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
}
