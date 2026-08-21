/**
 * VoiceRecordButton — hold-to-record with slide-to-cancel.
 *
 * Mic stream is acquired on first pointerdown (user gesture required by
 * Chrome), then kept open for subsequent recordings. MediaRecorder starts
 * on pointerdown and stops on pointerup. Slide left to cancel.
 *
 * Confirm step: transcript is shown in an editable field. Nothing executes
 * automatically — the user must review and tap Send.
 */

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Mic, Send, X, ArrowLeft } from 'lucide-react';
import { transcribeAudio } from '@/lib/voiceService';
import { acquireMicStream, micErrorMessage, type MicStream } from '@/lib/micStream';

/* ========================================================================== */
/* Types                                                                       */
/* ========================================================================== */

type RecordState = 'idle' | 'needsMic' | 'acquiring' | 'recording' | 'processing' | 'confirm';

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
  onTranscribe: (text: string) => void;
}

export function VoiceRecordButton({ onTranscribe }: VoiceRecordButtonProps) {
  const [state, setState] = useState<RecordState>('needsMic');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [slideOffset, setSlideOffset] = useState(0);
  const [recordTime, setRecordTime] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MicStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number>(0);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordTimeRef = useRef(0);

  /* ── Acquire mic stream (called on first user gesture) ────────────────── */

  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    setState('acquiring');
    setError(null);
    try {
      const mic = await acquireMicStream();
      micRef.current = mic;
      streamRef.current = mic.stream;
      analyserRef.current = mic.analyser;
      console.log('[SAM] Microphone acquired');
      setState('idle');
      return mic.stream;
    } catch (err) {
      console.error('[SAM] Microphone error:', err);
      setError(micErrorMessage(err));
      setState('needsMic');
      return null;
    }
  }, []);

  /* ── Cleanup on unmount ───────────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      micRef.current?.close();
      if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ── Audio level meter ────────────────────────────────────────────────── */

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

  /* ── Recording lifecycle ──────────────────────────────────────────────── */

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setError('No microphone. Tap the mic button to enable it first.');
      return;
    }

    cancelledRef.current = false;
    chunksRef.current = [];
    setSlideOffset(0);
    setRecordTime(0);
    recordTimeRef.current = 0;
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

      const duration = recordTimeRef.current;
      if (cancelledRef.current || duration * 1000 < MIN_RECORD_MS) {
        setState('idle');
        return;
      }

      setState('processing');
      console.log('[SAM] Transcribing audio, duration:', duration.toFixed(1), 's, size:', blob.size);

      try {
        const result = await transcribeAudio(blob);
        console.log('[SAM] Transcript:', result.transcript, 'latency:', result.latencyMs, 'ms');
        if (!result.transcript) {
          setError('No speech detected. Try again.');
          setState('idle');
        } else {
          setTranscript(result.transcript);
          setState('confirm');
        }
      } catch (err) {
        console.error('[SAM] Transcription error:', err);
        setError(err instanceof Error ? err.message : 'Transcription failed');
        setState('idle');
      }
    };

    recorder.start(100);
    setState('recording');
    startLevelMeter();

    timerRef.current = setInterval(() => {
      recordTimeRef.current += 0.1;
      setRecordTime(recordTimeRef.current);
      if (recordTimeRef.current >= MAX_RECORD_MS / 1000) {
        stopRecording();
      }
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startLevelMeter, stopLevelMeter]);

  /* ── Pointer event handlers ───────────────────────────────────────────── */

  const onPointerDown = useCallback(async (e: React.PointerEvent) => {
    e.preventDefault();

    // Acquire mic on first press (user gesture required).
    if (!streamRef.current) {
      const stream = await acquireMic();
      if (!stream) return; // user denied or error — error state already set
      // Short delay to let the stream settle.
      await new Promise((r) => setTimeout(r, 100));
    }

    if (recorderRef.current?.state === 'recording') return;

    startPosRef.current = { x: e.clientX, y: e.clientY };
    startRecording();
  }, [acquireMic, startRecording]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startPosRef.current) return;

    const dx = startPosRef.current.x - e.clientX;
    setSlideOffset(Math.max(0, dx));

    if (dx > CANCEL_SLIDE_PX) {
      cancelledRef.current = true;
      setState('idle');
      stopRecording();
      stopLevelMeter();
      setSlideOffset(0);
      startPosRef.current = null;
    }
  }, [stopRecording, stopLevelMeter]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    startPosRef.current = null;

    if (recorderRef.current?.state === 'recording') {
      stopRecording();
    }
  }, [stopRecording]);

  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
    setState('idle');
    stopRecording();
    stopLevelMeter();
    startPosRef.current = null;
  }, [stopRecording, stopLevelMeter]);

  /* ── Confirm / dismiss ────────────────────────────────────────────────── */

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

  /* ── Render ───────────────────────────────────────────────────────────── */

  // Confirm step
  if (state === 'confirm') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <textarea
            className="flex-1 bg-void-900 border border-accent/30 rounded-lg px-3 py-2
                       text-void-100 text-base font-mono resize-none focus:border-accent
                       focus:outline-none min-h-[5rem]"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={4}
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
                         text-dim-300 hover:text-dim-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Processing spinner
  if (state === 'processing') {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-void-800 border border-void-600
                   rounded-full text-dim-300 text-sm">
        <span className="inline-block w-3 h-3 rounded-full bg-accent animate-pulse" />
        Transcribing...
      </div>
    );
  }

  // Acquiring mic
  if (state === 'acquiring') {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-void-800 border border-void-600
                   rounded-full text-dim-300 text-sm">
        <span className="inline-block w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
        Enabling microphone...
      </div>
    );
  }

  const isRecording = state === 'recording';
  const cancelOpacity = Math.max(0, 1 - slideOffset / CANCEL_SLIDE_PX);

  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Slide-to-cancel indicator */}
        {isRecording && (
          <div
            className="flex items-center gap-1 text-amber-400 text-xs font-medium transition-opacity shrink-0"
            style={{ opacity: slideOffset > 10 ? 1 : 0 }}
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Slide to cancel</span>
          </div>
        )}

        {/* Record / Enable mic button */}
        <button
          type="button"
          onPointerDown={state === 'needsMic' ? (async (e) => { e.preventDefault(); await acquireMic(); }) : onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          className={`
            relative flex items-center justify-center gap-2 px-5 py-2.5
            rounded-full border text-sm font-medium transition-all select-none shrink-0
            ${isRecording
              ? 'bg-red-900/40 border-red-500/40 text-red-400 scale-110'
              : state === 'needsMic'
                ? 'bg-amber-900/30 border-amber-500/30 text-amber-400 hover:bg-amber-900/40'
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
          ) : state === 'needsMic' ? (
            <>
              <Mic size={16} />
              <span>Tap to enable mic</span>
            </>
          ) : (
            <>
              <Mic size={16} />
              <span>Hold to record</span>
            </>
          )}
        </button>

        {/* Audio level meter */}
        {isRecording && (
          <div className="hidden sm:flex items-end gap-0.5 h-6">
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
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-red-400">{error}</span>
          <button
            type="button"
            onClick={() => { setError(null); acquireMic(); }}
            className="text-xs text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
