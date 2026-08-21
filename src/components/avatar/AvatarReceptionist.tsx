'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Mic, RefreshCw, Volume2, Wifi, WifiOff, XCircle } from 'lucide-react';
import { SimliClient, LogLevel } from 'simli-client';

import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/Indicators';
import { Skeleton } from '@/components/ui/Skeleton';

import type {
  AvatarConnectionState,
  AvatarSession,
  AvatarErrorPayload,
} from '@/types/avatar';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TIMEOUT_MS = 15_000;
const EXPIRY_GRACE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAvatarErrorPayload(v: unknown): v is AvatarErrorPayload {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.code === 'string' && typeof r.message === 'string';
}

// ==========================================================================
// Component
// ==========================================================================

export default function AvatarReceptionist() {
  // --- Refs ----------------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const simliRef = useRef<SimliClient | null>(null);
  const aborterRef = useRef<AbortController | null>(null);
  const audioUnlocked = useRef(false);

  // --- State ---------------------------------------------------------------
  const [connection, setConnection] = useState<AvatarConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);

  // --- Derive --------------------------------------------------------------
  const isConnected = connection === 'ready' || connection === 'speaking';
  const isError = connection === 'error';

  // ==========================================================================
  // Bootstrap: fetch session credentials → construct SimliClient → start()
  // ==========================================================================

  const bootstrapSession = useCallback(async () => {
    setConnection('connecting');
    setErrorMessage(null);

    // Tear down any previous client
    if (simliRef.current) {
      await simliRef.current.stop().catch(() => {});
      simliRef.current = null;
    }

    try {
      // 1. Fetch session token + ICE servers from our server-side proxy
      const res = await fetch('/api/avatar/session', {
        method: 'POST',
        signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
      });

      const json: unknown = await res.json();

      if (!res.ok && isAvatarErrorPayload(json)) {
        throw new Error(json.message);
      }

      const session = json as AvatarSession;
      if (!session.sessionToken) {
        throw new Error('Server returned an empty session token.');
      }

      setSessionExpiresAt(new Date(session.expiresAt).getTime());

      // 2. Construct the real SimliClient (constructor = the old "Initialize")
      const client = new SimliClient(
        session.sessionToken,
        videoRef.current!,
        audioRef.current!,
        session.iceServers.length > 0 ? session.iceServers : null,
        LogLevel.ERROR,        // keep the console quiet
        'p2p',                 // transport: P2P with ICE servers
        'websockets',          // signaling
        'wss://api.simli.ai',  // WS URL
        3000,                  // audio buffer size
      );

      // 3. Connect — this retries internally up to 10 times
      await client.start();
      simliRef.current = client;
      setConnection('ready');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to connect to avatar service.';
      setErrorMessage(msg);
      setConnection('error');
    }
  }, []);

  // --- Mount / unmount ----------------------------------------------------

  useEffect(() => {
    bootstrapSession();

    return () => {
      simliRef.current?.stop().catch(() => {});
      simliRef.current = null;
    };
  }, [bootstrapSession]);

  // --- Session expiry watchdog --------------------------------------------

  useEffect(() => {
    if (sessionExpiresAt === null) return;

    const remaining = sessionExpiresAt - Date.now() - EXPIRY_GRACE_MS;
    if (remaining <= 0) {
      bootstrapSession();
      return;
    }

    const id = setTimeout(() => bootstrapSession(), remaining);
    return () => clearTimeout(id);
  }, [sessionExpiresAt, bootstrapSession]);

  // ==========================================================================
  // Speak handler
  // ==========================================================================

  const handleSpeak = useCallback(async () => {
    if (!inputText.trim() || isLoading || !isConnected) return;

    const client = simliRef.current;
    if (!client) {
      setErrorMessage('Avatar client not initialised. Please refresh.');
      setConnection('error');
      return;
    }

    // Unlock the browser audio context on first user gesture
    if (!audioUnlocked.current && audioRef.current) {
      await audioRef.current.play().catch(() => {});
      audioUnlocked.current = true;
      audioRef.current?.pause();
    }

    setIsLoading(true);
    setConnection('speaking');

    const controller = new AbortController();
    aborterRef.current = controller;

    try {
      // 1. Fetch TTS audio from our server-side proxy (API key stays on server)
      const ttsRes = await fetch('/api/avatar/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
        signal: controller.signal,
      });

      if (!ttsRes.ok) {
        const errJson: unknown = await ttsRes.json().catch(() => null);
        const msg = isAvatarErrorPayload(errJson)
          ? errJson.message
          : `TTS request failed (${ttsRes.status})`;
        throw new Error(msg);
      }

      if (!ttsRes.body) {
        throw new Error('TTS response has no stream body.');
      }

      // 2. Stream PCM chunks directly into Simli's WebRTC pipeline
      const reader = ttsRes.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.byteLength > 0) {
          try {
            client.sendAudioData(value);
          } catch {
            controller.abort();
            throw new Error(
              'Avatar connection dropped during speech. Check your network and try again.',
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Intentional cancel — not an error
      } else {
        const msg =
          err instanceof Error ? err.message : 'Speech generation failed.';
        setErrorMessage(msg);
        setConnection('error');
      }
    } finally {
      setIsLoading(false);
      setInputText('');
      aborterRef.current = null;
      setConnection((prev) => (prev === 'error' ? 'error' : 'ready'));
    }
  }, [inputText, isLoading, isConnected]);

  // --- Cancel ---------------------------------------------------------------

  const handleCancel = useCallback(() => {
    aborterRef.current?.abort();
  }, []);

  // ==========================================================================
  // Render: connecting
  // ==========================================================================

  if (connection === 'connecting') {
    return (
      <div className="glass flex w-full max-w-md flex-col gap-4 rounded-2xl p-6">
        <div className="flex items-center gap-2.5">
          <StatusDot tone="warning" pulse size={8} />
          <span className="label">Establishing avatar link</span>
        </div>

        <div className="glass-sunken relative aspect-square w-full overflow-hidden rounded-xl">
          <Skeleton className="absolute inset-0 rounded-xl" delay={0} />
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="animate-[sam-breathe_2.2s_ease-in-out_infinite] text-[11px] text-slate-500">
              Negotiating WebRTC session…
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1 rounded-lg" delay={150} />
          <Skeleton className="h-10 w-20 rounded-lg" delay={220} />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: error
  // ==========================================================================

  if (isError && errorMessage) {
    return (
      <div className="glass flex w-full max-w-md flex-col gap-4 rounded-2xl p-6">
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={14} className="text-alarm-400" />
          <span className="label" style={{ color: 'var(--color-alarm-400)' }}>
            Avatar offline
          </span>
        </div>

        <div className="glass-sunken relative flex aspect-square w-full items-center justify-center rounded-xl">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <XCircle size={28} className="text-alarm-400/60" />
            <p className="max-w-[42ch] text-[11.5px] leading-relaxed text-slate-400 italic">
              {errorMessage}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => bootstrapSession()}
          className="flex items-center justify-center gap-2 rounded-lg border border-alarm-400/30 bg-alarm-500/10 px-4 py-2.5 font-mono text-[10.5px] tracking-[0.14em] text-alarm-300 uppercase transition-colors hover:bg-alarm-500/20"
        >
          <RefreshCw size={13} />
          Reconnect
        </button>
      </div>
    );
  }

  // ==========================================================================
  // Render: idle (standby — shouldn't normally render, but safe)
  // ==========================================================================

  if (connection === 'idle') {
    return (
      <div className="glass flex w-full max-w-md flex-col gap-4 rounded-2xl p-6">
        <div className="glass-sunken relative flex aspect-square w-full items-center justify-center rounded-xl">
          <p className="text-[11px] text-slate-500">Avatar standby</p>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: ready or speaking (live video)
  // ==========================================================================

  return (
    <div className="glass flex w-full max-w-md flex-col gap-4 rounded-2xl p-6">
      {/* ---- Status bar --------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StatusDot
            tone={connection === 'speaking' ? 'accent-2' : 'success'}
            pulse={connection === 'speaking'}
            size={8}
          />
          <span className="label">
            {connection === 'speaking' ? 'Speaking' : 'Ready'}
          </span>
        </div>

        <div
          className="flex items-center gap-1.5"
          title={isConnected ? 'WebRTC connected' : 'Disconnected'}
        >
          {isConnected ? (
            <Wifi size={11} className="text-toxic-400" />
          ) : (
            <WifiOff size={11} className="text-alarm-400" />
          )}
          <span
            className={cn(
              'text-[9.5px] tabular',
              isConnected ? 'text-toxic-400' : 'text-alarm-400',
            )}
          >
            {isConnected ? 'live' : 'off'}
          </span>
        </div>
      </div>

      {/* ---- Video window ------------------------------------------------ */}
      <div className="glass-sunken brackets relative aspect-square w-full overflow-hidden rounded-xl">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
        <audio ref={audioRef} autoPlay playsInline />

        {connection === 'speaking' && (
          <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-void-950/70 px-2.5 py-1 backdrop-blur">
            <Volume2
              size={12}
              className="animate-[sam-breathe_0.7s_ease-in-out_infinite] text-flux-300"
            />
            <span className="text-[9px] tabular text-flux-300">streaming</span>
          </div>
        )}
      </div>

      {/* ---- Input & controls -------------------------------------------- */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Mic
            size={12}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSpeak();
              }
            }}
            placeholder="Type something for the receptionist to say…"
            disabled={isLoading}
            className={cn(
              'w-full rounded-lg border py-2.5 pl-9 pr-3',
              'bg-void-900/70 text-[13px] text-slate-200',
              'border-void-500/60 focus:border-flux-400/70 focus:outline-none focus:ring-1 focus:ring-flux-400/30',
              'placeholder:text-slate-600',
              'disabled:opacity-40',
            )}
          />
        </div>

        {isLoading ? (
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-1.5 rounded-lg border border-alarm-400/40 bg-alarm-500/10 px-4 py-2.5 font-mono text-[10.5px] tracking-[0.1em] text-alarm-300 uppercase transition-colors hover:bg-alarm-500/20"
          >
            <XCircle size={13} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSpeak}
            disabled={!inputText.trim()}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-2.5 font-mono text-[10.5px] tracking-[0.1em] uppercase transition-all',
              'bg-flux-500/15 text-flux-300 border border-flux-400/30',
              'hover:bg-flux-500/25 hover:border-flux-400/50',
              'disabled:cursor-not-allowed disabled:opacity-30',
            )}
          >
            <Volume2 size={13} />
            Speak
          </button>
        )}
      </div>

      <p className="text-right text-[9.5px] text-slate-600">
        Press{' '}
        <kbd className="rounded-[2px] bg-void-600 px-1 py-px font-mono text-[9px] text-slate-400">
          Enter
        </kbd>{' '}
        to send
      </p>
    </div>
  );
}
