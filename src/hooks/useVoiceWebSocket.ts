'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TranscriptEntry {
  id: number;
  role: 'sam' | 'user';
  text: string;
  ts: number;
}

export interface ToolCallEntry {
  id: number;
  name: string;
  input: Record<string, unknown>;
  state: 'running' | 'done';
  result?: string;
  ts: number;
}

/* ========================================================================== */
/* Audio queue — sequential mp3 playback                                      */
/* ========================================================================== */

class AudioQueue {
  private _queue: Blob[] = [];
  private _playing = false;
  private _current: HTMLAudioElement | null = null;
  private _onStateChange?: (speaking: boolean) => void;

  set onStateChange(fn: ((speaking: boolean) => void) | undefined) {
    this._onStateChange = fn;
  }

  enqueue(blob: Blob) {
    this._queue.push(blob);
    if (!this._playing) this._playNext();
  }

  clear() {
    this._queue = [];
    if (this._current) {
      this._current.pause();
      this._current.src = '';
      this._current = null;
    }
    this._playing = false;
    this._onStateChange?.(false);
  }

  private _playNext() {
    if (this._queue.length === 0) {
      this._playing = false;
      this._onStateChange?.(false);
      return;
    }
    this._playing = true;
    const blob = this._queue.shift()!;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this._current = audio;
    this._onStateChange?.(true);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      this._current = null;
      this._playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      this._current = null;
      this._playNext();
    };
    audio.play().catch(() => {
      URL.revokeObjectURL(url);
      this._current = null;
      this._playNext();
    });
  }
}

/* ========================================================================== */
/* Hook                                                                       */
/* ========================================================================== */

let _nextId = 1;
function uid(): number {
  return _nextId++;
}

export function useVoiceWebSocket(url = 'ws://127.0.0.1:8790/ws') {
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audioSpeaking, setAudioSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<AudioQueue>(new AudioQueue());

  /* ---- Connect ----------------------------------------------------------- */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionState('connecting');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // Wire audio queue state callback
    audioQueueRef.current.onStateChange = (speaking) => {
      setAudioSpeaking(speaking);
    };

    ws.onopen = () => {
      setConnectionState('connected');
      setError(null);
    };

    ws.onmessage = (event) => {
      // Binary frame → mp3 audio from server
      if (event.data instanceof ArrayBuffer) {
        const blob = new Blob([event.data], { type: 'audio/mpeg' });
        audioQueueRef.current.enqueue(blob);
        return;
      }

      // JSON frame
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      const type = msg.type as string;

      switch (type) {
        case 'state':
          setVoiceState((msg.state as VoiceState) ?? 'idle');
          break;

        case 'sentence': {
          const text = (msg.text as string) ?? '';
          if (!text.trim()) break;
          const entry: TranscriptEntry = {
            id: uid(),
            role: 'sam',
            text: text.trim(),
            ts: Date.now(),
          };
          setTranscript((prev) => [...prev, entry]);
          break;
        }

        case 'transcript': {
          const text = (msg.text as string) ?? '';
          if (!text.trim()) break;
          const entry: TranscriptEntry = {
            id: uid(),
            role: 'user',
            text: text.trim(),
            ts: Date.now(),
          };
          setTranscript((prev) => [...prev, entry]);
          break;
        }

        case 'tool_use': {
          const name = (msg.name as string) ?? 'unknown';
          const input = (msg.input as Record<string, unknown>) ?? {};
          const tc: ToolCallEntry = {
            id: uid(),
            name,
            input,
            state: 'running',
            ts: Date.now(),
          };
          setToolCalls((prev) => [...prev, tc]);
          break;
        }

        case 'tool_result': {
          const tName = (msg.name as string) ?? '';
          const output = (msg.output as string) ?? '';
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.name === tName && tc.state === 'running'
                ? { ...tc, state: 'done' as const, result: output }
                : tc,
            ),
          );
          break;
        }

        case 'error':
          setError((msg.message as string) ?? 'Unknown error');
          break;
      }
    };

    ws.onclose = () => {
      setConnectionState('disconnected');
      wsRef.current = null;
      audioQueueRef.current.clear();
    };

    ws.onerror = () => {
      // onclose fires after onerror
    };
  }, [url]);

  /* ---- Disconnect -------------------------------------------------------- */
  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionState('disconnected');
  }, []);

  /* ---- Auto-connect on mount, cleanup on unmount ------------------------ */
  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      audioQueueRef.current.clear();
    };
  }, [connect]);

  /* ---- Send methods ------------------------------------------------------ */
  const sendText = useCallback((text: string) => {
    const entry: TranscriptEntry = {
      id: uid(),
      role: 'user',
      text,
      ts: Date.now(),
    };
    setTranscript((prev) => [...prev, entry]);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text }));
    }
  }, []);

  const sendAudio = useCallback((audioBlob: Blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioBlob);
    }
  }, []);

  const sendInterrupt = useCallback(() => {
    audioQueueRef.current.clear();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
  }, []);

  const clearTranscript = useCallback(() => setTranscript([]), []);
  const clearToolCalls = useCallback(() => setToolCalls([]), []);

  return {
    connectionState,
    voiceState,
    transcript,
    toolCalls,
    error,
    audioSpeaking,
    sendText,
    sendAudio,
    sendInterrupt,
    clearTranscript,
    clearToolCalls,
    connect,
    disconnect,
  };
}
