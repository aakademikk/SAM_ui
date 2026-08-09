'use client';

/**
 * Shared mic-waveform bus.
 *
 * ChatVoiceWidget pushes real-time AnalyserNode data here while the user holds
 * the mic button; VisualiserWidget reads it in its animation loop and overrides
 * the server-polled (TTS-derived) waveform so the pulse tracks the user's voice
 * instead of SAM's speech output.
 */

type Listener = (waveform: number[] | null) => void;

let currentWaveform: number[] | null = null;
let waveformTimestamp = 0;
const listeners = new Set<Listener>();

export function setMicWaveform(waveform: number[] | null): void {
  currentWaveform = waveform;
  waveformTimestamp = waveform ? Date.now() : 0;
  for (const fn of listeners) fn(waveform);
}

export function getMicWaveform(): { waveform: number[]; timestamp: number } | null {
  if (!currentWaveform) return null;
  return { waveform: currentWaveform, timestamp: waveformTimestamp };
}

export function subscribeToMicWaveform(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
