/**
 * SAM — client-side handoff state helper (review finding 6).
 *
 * `handoffError` and `handedOffTo` are the server's record of a PREVIOUS
 * handoff attempt. `chat/page.tsx`'s waiting effect starts reading them the
 * instant `handoffWaitingFor` is set — the moment a new handoff's POST
 * resolves — so if they are left in place, that effect jumps on the old
 * attempt's outcome (a stale error, or the old `handedOffTo`) before the new
 * attempt has gone anywhere near either field for real. Clearing the local
 * copy here mirrors `chatStore.ts`'s `clearHandoffState`, which the server
 * now does for the same reason at the start of `startHandoff`.
 */

export interface HandoffFields {
  handoffError?: string;
  handedOffTo?: string;
}

/** A copy of `info` with its handoff fields cleared. Call this the moment a
 *  new handoff is accepted, before the waiting effect gets a chance to read
 *  either field. */
export function clearedHandoffFields<T extends HandoffFields>(info: T): T {
  const next = { ...info };
  delete next.handoffError;
  delete next.handedOffTo;
  return next;
}
