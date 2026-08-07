'use client';

import { useEffect, useState } from 'react';

/**
 * A shared ticking clock.
 *
 * Returns `null` on the server and on the first client render, then the real
 * epoch time. Every relative timestamp in the console reads from this so the
 * server never renders a value the client immediately disagrees with.
 */
export function useLiveClock(intervalMs = 15_000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** True once the component has mounted on the client. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
