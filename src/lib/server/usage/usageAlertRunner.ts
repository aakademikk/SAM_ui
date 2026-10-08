/**
 * Usage alerts: formerly the glue between the tile's readings, `decideAlerts`
 * and the phone push. Colin asked for fewer pings (2026-10-08): the seat guard
 * in `sam-dispatch` refuses dispatches at 80% and the dashboard shows usage, so
 * no "SAM usage" push is sent any more. Usage is still logged (that is
 * `sam-quota-log` and the harvester, not this module). The entry point is kept
 * so its callers (the sweep and the collector) need no change.
 */

/** Sends nothing. Resolves with the pings actually sent: always none. */
export function runUsageAlerts(_now: number = Date.now()): Promise<never[]> {
  return Promise.resolve([]);
}
