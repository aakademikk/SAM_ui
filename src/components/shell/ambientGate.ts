/**
 * Ambient-background gate (audit D-01). The fleet views paint opaque over the
 * app-wide background, so a full-screen Three.js loop would run unseen. Each
 * fleet view registers while mounted; AppShell unmounts the background while
 * any are. Count-based so a StrictMode double mount stays balanced.
 */

import { createElement, Fragment, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

let count = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of Array.from(listeners)) l();
}

/** Mark a fleet view as mounted; the returned function unregisters (once). */
export function registerFleetView(): () => void {
  let done = false;
  count += 1;
  emit();
  return () => {
    if (done) return;
    done = true;
    count -= 1;
    emit();
  };
}

export function fleetViewMounted(): boolean {
  return count > 0;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useFleetViewMounted(): boolean {
  // The server snapshot reads the live count too, so a server render (and the
  // static render in the test) sees the current value. On a real server nothing
  // registers, so it is false there and hydration agrees with the client's first paint.
  return useSyncExternalStore(subscribe, fleetViewMounted, fleetViewMounted);
}

/** Renders its children (the ambient background) unless booting or a fleet view is up. */
export function AmbientBackgroundGate({ booting, children }: { booting: boolean; children?: ReactNode }) {
  const fleetUp = useFleetViewMounted();
  return booting || fleetUp ? null : createElement(Fragment, null, children);
}
