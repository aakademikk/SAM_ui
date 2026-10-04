/**
 * SAM — global auth gate.
 *
 * Open question 1 (resolved, ux-fixes-spec.md §6): a revoked device must not
 * just go stale — it has to notice and show "This device has been signed
 * out." Every one of the app's ~10 fetch services already swallows its own
 * 401s locally (by design, so a blip doesn't break a widget); this hook is
 * additive shared infrastructure sitting beside all of that, not a rewrite of
 * it. It polls the one endpoint that already fails closed the instant a
 * session's credential is gone (`GET /api/auth/session`, backed by T1's
 * `verifySession`), and flips the whole app behind `SignedOutOverlay` when a
 * device that was previously seen authenticated comes back unauthenticated.
 * A visitor who was never signed in is not blocked.
 */

'use client';

import { useEffect, useRef, useState } from 'react';

export type AuthGateState = 'ok' | 'signed-out';

/**
 * Tri-state result of one poll. `'unknown'` means the poll produced no
 * trustworthy answer (network failure, non-401 server error, unparseable
 * body) — it is neither evidence of a session nor of a revoke.
 */
export type AuthPollResult = 'authenticated' | 'not-authenticated' | 'unknown';

const POLL_MS = 5000;

/**
 * Pure state transition, extracted so it can be unit tested without a DOM,
 * a fake timer harness, or a fetch mock (none of which this repo's
 * `node --test` runner wires up for hooks — see useAuthGate.test.ts).
 *
 * The gate only flips to `'signed-out'` for a device that WAS signed in
 * during this hook's lifetime (`seenAuthenticated`) and is now reporting
 * not-authenticated — i.e. a revoke. A visitor who has only ever been
 * logged out stays `'ok'` (no blocking overlay hiding the Login button);
 * once they sign in, `seenAuthenticated` arms the gate for a later revoke.
 * `'unknown'` polls never change state.
 *
 * `'signed-out'` is terminal for a given hook lifetime: once the device has
 * been told it's signed out, there is no value in polling further — the
 * person has to re-authenticate (SignedOutOverlay), at which point the page
 * reloads and a fresh hook instance starts from `'ok'` again.
 */
export function nextGateState(
  current: AuthGateState,
  poll: AuthPollResult,
  seenAuthenticated: boolean,
): AuthGateState {
  if (current === 'signed-out') {
    return 'signed-out';
  }
  if (poll === 'not-authenticated' && seenAuthenticated) {
    return 'signed-out';
  }
  return 'ok';
}

/**
 * Pure update of the "has this hook ever seen an authenticated poll" flag.
 * Only an explicit `'authenticated'` result arms it; it never un-arms.
 */
export function nextSeenAuthenticated(seenAuthenticated: boolean, poll: AuthPollResult): boolean {
  return seenAuthenticated || poll === 'authenticated';
}

/**
 * Classify `GET /api/auth/session`. HTTP 401 and a 200 body whose
 * `data.authenticated` is not `true` both count as `'not-authenticated'` per
 * the spec's resolved open question. A network failure (offline, DNS hiccup),
 * any other non-OK status, or an unparseable body is `'unknown'` — only an
 * explicit answer from the server counts, so a flaky connection neither
 * flashes the overlay on a still-valid session nor falsely arms the gate.
 */
async function pollAuthStatus(): Promise<AuthPollResult> {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    if (response.status === 401) {
      return 'not-authenticated';
    }
    if (!response.ok) {
      return 'unknown';
    }
    const json: unknown = await response.json();
    const record = json as { data?: { authenticated?: unknown } };
    return record?.data?.authenticated === true ? 'authenticated' : 'not-authenticated';
  } catch {
    return 'unknown';
  }
}

/**
 * Polls the session endpoint every 5s, starting once on mount. Returns
 * `'ok'` until a device that was seen authenticated later polls
 * not-authenticated (a revoke), then flips to `'signed-out'` and stops
 * polling. A never-signed-in visitor stays `'ok'` and polling continues.
 */
export function useAuthGate(): AuthGateState {
  const [state, setState] = useState<AuthGateState>('ok');
  const stateRef = useRef<AuthGateState>('ok');
  const seenAuthenticatedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled || stateRef.current === 'signed-out') {
        return;
      }
      const poll = await pollAuthStatus();
      if (cancelled) {
        return;
      }
      const next = nextGateState(stateRef.current, poll, seenAuthenticatedRef.current);
      seenAuthenticatedRef.current = nextSeenAuthenticated(seenAuthenticatedRef.current, poll);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
      }
      if (next === 'signed-out' && intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    intervalId = setInterval(tick, POLL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, []);

  return state;
}
