'use client';

import { useEffect, useRef, useState } from 'react';

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type VisualiserState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'alert';

export interface VisualiserSnapshot {
  state: VisualiserState;
  waveform: number[];
  timestamp: number;
  mode: 'real' | 'mock';
  loading: boolean;
}

interface StateResponse {
  state?: string;
  waveform?: number[];
  waveform_timestamp?: number;
  timestamp?: number;
  mode?: string;
  loading?: boolean;
}

/* ========================================================================== */
/* Mock cycle (matches voice-visualizer/server.py MOCK_SEQUENCE)              */
/* ========================================================================== */

const MOCK_SEQUENCE: [VisualiserState, number][] = [
  ['idle', 6],
  ['listening', 5],
  ['thinking', 5],
  ['speaking', 6],
  ['alert', 3],
  ['idle', 2],
  ['thinking', 4],
  ['speaking', 5],
  ['listening', 4],
  ['idle', 8],
];

const VALID_STATES = new Set<string>(['idle', 'listening', 'thinking', 'speaking', 'alert']);

/** Generate a fake 64-sample waveform matching the Python server's formula. */
function mockWaveform(now: number): number[] {
  const samples: number[] = [];
  for (let i = 0; i < 64; i++) {
    const t = now * 12 + i * 0.3;
    const val =
      (Math.sin(t) * 0.6 +
        Math.sin(t * 2.3) * 0.3 +
        Math.sin(t * 5.1) * 0.2 +
        (Math.random() * 0.06 - 0.03)) *
      (0.5 + 0.5 * Math.sin(now * 0.7));
    samples.push(Number(val.toFixed(4)));
  }
  return samples;
}

/* ========================================================================== */
/* Hook                                                                       */
/* ========================================================================== */

const POLL_INTERVAL = 100; // ms
const FETCH_TIMEOUT = 2000; // ms

/**
 * Polls a `/state` endpoint every 100 ms and returns the latest visualiser
 * state.  Falls back to a local mock cycle when the server is unreachable so
 * the canvas always has something to render.
 */
export function useVisualiserState(stateUrl: string = '/state'): VisualiserSnapshot {
  const [snapshot, setSnapshot] = useState<VisualiserSnapshot>({
    state: 'idle',
    waveform: new Array(64).fill(0),
    timestamp: 0,
    mode: 'mock',
    loading: false,
  });

  // Keep mock-timer state in a ref so we don't restart on every URL change.
  const mockRef = useRef({ start: Date.now() / 1000 });

  useEffect(() => {
    let active = true;
    let pollInFlight = false;
    let pollFailing = true;

    // AbortController for fetch timeout
    function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
          reject(new DOMException('timeout', 'AbortError'));
        }, timeout);
        fetch(url, { signal: controller.signal })
          .then((r) => {
            clearTimeout(timer);
            resolve(r);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    }

    async function poll() {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const res = await fetchWithTimeout(stateUrl, FETCH_TIMEOUT);
        if (!active) return;
        if (res.status !== 200) {
          pollFailing = true;
          return;
        }
        const data: StateResponse = await res.json();
        if (!active) return;

        pollFailing = false;

        const state = VALID_STATES.has(data.state ?? '') ? (data.state as VisualiserState) : 'idle';
        const waveform = data.waveform && data.waveform.length === 64 ? data.waveform : new Array(64).fill(0);
        const timestamp = data.timestamp ?? Date.now() / 1000;
        const mode = data.mode === 'real' ? 'real' : 'mock';
        const loading = data.loading ?? false;

        setSnapshot({ state, waveform, timestamp, mode, loading });
      } catch {
        // Server unreachable — will fall back to mock below
        if (active) pollFailing = true;
      } finally {
        if (active) pollInFlight = false;
      }
    }

    // Initial poll
    void poll();

    // Polling interval
    const pollTimer = setInterval(poll, POLL_INTERVAL);

    // Mock fallback: runs on a separate 100ms tick, only active when polling is failing
    const mockTimer = setInterval(() => {
      if (!pollFailing) return;
      const now = Date.now() / 1000;
      const elapsed = now - mockRef.current.start;
      const totalDuration = MOCK_SEQUENCE.reduce((s, [, d]) => s + d, 0);
      const cycleTime = elapsed % totalDuration;

      let accumulated = 0;
      let currentState: VisualiserState = 'idle';

      for (const [stateName, duration] of MOCK_SEQUENCE) {
        if (cycleTime < accumulated + duration) {
          currentState = stateName;
          break;
        }
        accumulated += duration;
      }

      const waveform =
        currentState === 'speaking' ? mockWaveform(now) : new Array(64).fill(0);

      setSnapshot({
        state: currentState,
        waveform,
        timestamp: now,
        mode: 'mock',
        loading: currentState === 'thinking',
      });
    }, POLL_INTERVAL);

    return () => {
      active = false;
      clearInterval(pollTimer);
      clearInterval(mockTimer);
    };
  }, [stateUrl]);

  return snapshot;
}
