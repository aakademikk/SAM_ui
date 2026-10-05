/**
 * Usage sweep: every minute, inside the SAM_ui server, run the usage alerts.
 *
 * A chat turn's exit hook already does this for chat readings. A reading
 * written by a fleet job or the hourly timer has no hook in SAM_ui, so this
 * light sweep picks it up: it reads the mtime-cached rows and sends only
 * through `sam-push`. No Claude run, no probe, no network. `runUsageAlerts`
 * serialises and records state, so the sweep and the chat hook never double-ping.
 */

import { serialTick } from '@/lib/server/serialTick';
import { runUsageAlerts } from '@/lib/server/usage/usageAlertRunner';

const SWEEP_INTERVAL_MS = 60_000;

let stopCurrent: (() => void) | null = null;

/** Starts the sweep once; a second call returns the same stop function.
 *  The timer is unref'd so it never keeps the process alive. */
export function startUsageSweep(intervalMs: number = SWEEP_INTERVAL_MS): () => void {
  if (stopCurrent) return stopCurrent;
  const tick = serialTick(async () => {
    try {
      await runUsageAlerts();
    } catch {
      // An alert failure must never disturb the server; the next sweep retries.
    }
  });
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}
