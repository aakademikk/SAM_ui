/**
 * SAM — a per-tab id for the focus heartbeat (review finding 9).
 *
 * `sessionStorage` survives a reload of this tab but never a new one — a
 * fresh tab or window (even on the same device, even to the same origin)
 * starts with its own empty `sessionStorage`, so it mints its own id. Folded
 * into the focus report's key (device + tab) so two tabs or windows on one
 * device each get their own entry server-side instead of overwriting each
 * other's.
 */
const KEY = 'sam-tab-id';

export function tabId(storage: Storage): string {
  const existing = storage.getItem(KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  storage.setItem(KEY, fresh);
  return fresh;
}
