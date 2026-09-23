/**
 * Wrap an async interval callback so ticks never overlap.
 *
 * `setInterval(async () => …, 100)` does not wait for the previous tick: when a
 * disk read takes longer than the interval, two ticks run at once, both see the
 * same new output, and both send it. That is how a chat reply reached Colin
 * with a paragraph doubled on 2026-09-23 (the job stream route polls every
 * 100 ms). A tick that finds the previous one still running is skipped; the
 * next free tick picks up whatever it missed.
 */
export function serialTick(fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } finally {
      running = false;
    }
  };
}
