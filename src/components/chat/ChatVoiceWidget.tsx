'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageSquare, X, Send, Wifi, WifiOff, Loader2,
  ChevronDown, ChevronRight, Wrench, Terminal, Mic, MicOff, Volume2,
} from 'lucide-react';

import { useVoiceWebSocket } from '@/hooks/useVoiceWebSocket';
import type { VoiceState, ToolCallEntry } from '@/hooks/useVoiceWebSocket';
import { setMicWaveform, setAudioSpeaking } from '@/lib/client/micAnalyser';

/* ========================================================================== */
/* State colours                                                              */
/* ========================================================================== */

const STATE_COLORS: Record<VoiceState, string> = {
  idle: '#55ccdd',
  listening: '#66ddff',
  thinking: '#ffbb33',
  speaking: '#ffffff',
};

const STATE_LABELS: Record<VoiceState, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

/* ========================================================================== */
/* ToolActivityPanel                                                          */
/* ========================================================================== */

function ToolActivityPanel({ calls }: { calls: ToolCallEntry[] }) {
  const [collapsed, setCollapsed] = useState(false);

  if (calls.length === 0) return null;

  return (
    <div className="border-t border-void-500/50 px-3 py-2">
      <button
        type="button"
        className="mb-1.5 flex w-full items-center gap-1.5 text-[10px] tracking-[0.14em] text-slate-500 uppercase hover:text-slate-400"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        <Wrench size={10} />
        <span>Tool Activity</span>
        <span className="ml-auto font-mono text-[9px] text-slate-600">
          {calls.length}
        </span>
      </button>
      {!collapsed && (
        <div className="max-h-48 space-y-1 overflow-y-auto scrollbar-thin">
          {calls.map((tc) => (
            <ToolCallRow key={tc.id} call={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-sm border border-void-500/40 bg-void-900/60">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[10px] hover:bg-void-800/60"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {call.state === 'running' ? (
          <Loader2 size={10} className="animate-spin text-amber-400" />
        ) : (
          <Terminal size={10} className="text-emerald-400" />
        )}
        <span className="text-slate-300">{call.name}</span>
        <span className="ml-auto font-mono text-[9px] text-slate-600">
          {call.state === 'running' ? 'running' : 'done'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-void-600/40 px-2 py-1.5 font-mono text-[10px]">
          {Object.keys(call.input).length > 0 && (
            <div className="mb-1">
              <span className="text-slate-500">input </span>
              <pre className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-void-950/80 p-1 text-slate-400">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {call.result && (
            <div>
              <span className="text-slate-500">result </span>
              <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-void-950/80 p-1 text-slate-400">
                {call.result.length > 500 ? call.result.slice(0, 500) + '…' : call.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* ChatVoiceWidget                                                            */
/* ========================================================================== */

export function ChatVoiceWidget() {
  const {
    connectionState,
    voiceState,
    transcript,
    toolCalls,
    error,
    audioSpeaking,
    sendText,
    sendAudio,
    sendInterrupt,
    connect,
  } = useVoiceWebSocket();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [recording, setRecording] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);

  const connected = connectionState === 'connected';
  const disconnected = connectionState === 'disconnected';

  /* ---- Auto-scroll transcript -------------------------------------------- */
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  /* ---- Focus input on open ----------------------------------------------- */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* ---- Push audio-speaking flag to visualiser bus ------------------------- */
  useEffect(() => {
    setAudioSpeaking(audioSpeaking);
    // Clear mic waveform when audio starts so the mic override doesn't fight
    if (audioSpeaking) setMicWaveform(null);
  }, [audioSpeaking]);

  /* ---- Clean up media on unmount ----------------------------------------- */
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (micRafRef.current) cancelAnimationFrame(micRafRef.current);
      setMicWaveform(null);
      audioCtxRef.current?.close();
    };
  }, []);

  /* ---- Send handler ------------------------------------------------------ */
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !connected) return;
    sendText(text);
    setInput('');
  }, [input, connected, sendText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /* ---- Push-to-talk ------------------------------------------------------ */
  const startRecording = useCallback(async () => {
    if (!connected || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // ---- Mic analyser for visualiser -----------------------------------
      try {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);
        // deliberately not connected to destination — no feedback

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const readLevel = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(dataArray);
          const waveform = new Array<number>(64);
          const step = dataArray.length / 64;
          for (let i = 0; i < 64; i++) {
            waveform[i] = (dataArray[Math.floor(i * step)] - 128) / 128;
          }
          setMicWaveform(waveform);
          micRafRef.current = requestAnimationFrame(readLevel);
        };
        micRafRef.current = requestAnimationFrame(readLevel);
      } catch {
        // non-critical — visualiser just won't get mic waveform
      }

      // Prefer webm/opus; fall back to whatever the browser supports
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg;codecs=opus';

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onerror = () => {
        console.error('[PTT] MediaRecorder error');
        setRecording(false);
      };

      recorder.onstop = () => {
        const totalChunks = chunksRef.current.length;
        if (totalChunks > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          console.log(`[PTT] sending ${blob.size} bytes (${totalChunks} chunks, ${mimeType})`);
          sendAudio(blob);
        } else {
          console.warn('[PTT] no audio chunks recorded');
        }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
      };

      recorder.start(250); // collect chunks every 250ms
      console.log('[PTT] recording started');
      setRecording(true);
    } catch (err) {
      console.error('[PTT] mic access failed:', err);
      setRecording(false);
    }
  }, [connected, recording, sendAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    // Stop mic analyser
    if (micRafRef.current) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    setMicWaveform(null);
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
  }, []);

  /* ---- Spacebar push-to-talk ---------------------------------------------- */
  useEffect(() => {
    if (!open) return;

    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      startRecording();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
      stopRecording();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open, startRecording, stopRecording]);

  /* ---- State dot --------------------------------------------------------- */
  const stateColor = STATE_COLORS[voiceState] ?? STATE_COLORS.idle;

  return (
    <>
      {/* Floating toggle button */}
      {!open && (
        <button
          type="button"
          className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border border-void-400/50 bg-void-900/90 px-4 py-2.5 shadow-lg backdrop-blur-md transition-all hover:border-accent/50 hover:shadow-accent/20"
          style={{ boxShadow: connected ? `0 0 20px -4px ${stateColor}40` : undefined }}
          onClick={() => setOpen(true)}
        >
          {connected ? (
            <Wifi size={14} className="text-emerald-400" />
          ) : (
            <WifiOff size={14} className="text-alarm-400" />
          )}
          <span className="font-mono text-[11px] tracking-[0.12em] text-slate-300">
            SAM
          </span>
          {connected && (
            <span
              className="inline-block h-[6px] w-[6px] rounded-full"
              style={{ backgroundColor: stateColor }}
            />
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed right-4 bottom-4 z-50 flex w-[420px] flex-col overflow-hidden rounded-lg border border-void-400/50 bg-void-900/95 shadow-2xl backdrop-blur-xl"
          style={{ maxHeight: 'calc(100vh - 120px)', height: '560px' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-void-500/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-accent" />
              <span className="font-mono text-[11px] tracking-[0.12em] text-slate-300">
                SAM
              </span>
              {connected ? (
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-[5px] w-[5px] rounded-full"
                    style={{ backgroundColor: stateColor }}
                  />
                  <span className="font-mono text-[9px] tracking-[0.1em] text-slate-500">
                    {STATE_LABELS[voiceState] ?? 'Idle'}
                  </span>
                  {audioSpeaking && (
                    <Volume2 size={10} className="text-accent" />
                  )}
                </div>
              ) : (
                <span className="font-mono text-[9px] tracking-[0.1em] text-alarm-400">
                  OFFLINE
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {disconnected && (
                <button
                  type="button"
                  className="rounded-sm px-2 py-0.5 font-mono text-[9px] text-accent hover:bg-void-700/60"
                  onClick={connect}
                >
                  Reconnect
                </button>
              )}
              <button
                type="button"
                className="rounded-sm p-1 text-slate-600 hover:bg-void-700/60 hover:text-slate-400"
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Unavailable state */}
          {disconnected && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <WifiOff size={32} className="text-alarm-400/60" />
              <div>
                <p className="font-mono text-[11px] tracking-[0.1em] text-slate-400">
                  SAM Unavailable
                </p>
                <p className="mt-1 font-mono text-[9px] leading-relaxed text-slate-600">
                  Start the voice service from the{' '}
                  <code className="rounded bg-void-700/60 px-1 text-slate-400">
                    voice-line
                  </code>{' '}
                  directory:
                </p>
                <p className="mt-1 font-mono text-[9px] text-slate-500">
                  uv run python server.py
                </p>
              </div>
            </div>
          )}

          {/* Transcript */}
          {connected && (
            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
              {transcript.length === 0 && (
                <div className="flex h-full items-center justify-center">
                  <p className="font-mono text-[10px] tracking-[0.08em] text-slate-600">
                    Type a message or hold the mic button to talk…
                  </p>
                </div>
              )}

              {transcript.map((entry) => (
                <div
                  key={entry.id}
                  className={`mb-1.5 flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-md px-2.5 py-1.5 font-mono text-[11px] leading-relaxed ${
                      entry.role === 'user'
                        ? 'bg-accent/20 text-slate-200 border border-accent/30'
                        : 'bg-void-800/80 text-slate-300 border border-void-500/30'
                    }`}
                  >
                    {entry.text}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}

          {/* Error toast */}
          {error && connected && (
            <div className="border-t border-alarm-500/30 bg-alarm-500/10 px-3 py-1.5">
              <p className="font-mono text-[9px] text-alarm-300">{error}</p>
            </div>
          )}

          {/* Tool activity panel */}
          {connected && <ToolActivityPanel calls={toolCalls} />}

          {/* Input area */}
          {connected && (
            <div className="flex items-center gap-2 border-t border-void-500/50 px-3 py-2">
              {/* PTT mic button */}
              <button
                type="button"
                className={`rounded-full p-2 transition-all ${
                  recording
                    ? 'bg-alarm-500/30 border border-alarm-400/60 text-alarm-400 animate-pulse'
                    : 'border border-void-500/50 text-slate-500 hover:border-accent/40 hover:text-accent'
                }`}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                title="Hold to talk"
              >
                {recording ? <Mic size={14} /> : <MicOff size={14} />}
              </button>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  recording
                    ? 'Listening…'
                    : voiceState === 'thinking'
                      ? 'SAM is thinking…'
                      : 'Type a message…'
                }
                disabled={voiceState === 'thinking' || recording}
                className="flex-1 rounded-sm border border-void-500/50 bg-void-800/80 px-2.5 py-1.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-accent/60 focus:outline-none disabled:opacity-50"
              />

              {voiceState === 'thinking' || audioSpeaking ? (
                <button
                  type="button"
                  className="rounded-sm border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 font-mono text-[10px] text-amber-300 hover:bg-amber-500/25"
                  onClick={sendInterrupt}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-sm border border-accent/40 bg-accent/15 px-2.5 py-1.5 font-mono text-[10px] text-accent hover:bg-accent/25 disabled:opacity-40"
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <Send size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
