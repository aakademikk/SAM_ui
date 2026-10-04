/**
 * SAM — T3 (open question 1, resolved; ux-fixes-spec.md §6): useAuthGate's
 * pure state transition against a real revoke.
 *
 * `useAuthGate` itself is a `setInterval` + `fetch` React hook. This repo has
 * no React-hook test harness (no `@testing-library/*` in package.json, no
 * existing `.test.tsx` hook test to follow, and `tsconfig.test.json` only
 * compiles `src/**\/*.test.ts` — no JSX), so this follows the same
 * extract-the-pure-part pattern as `visual-upgrade-tickets.md` T11's
 * `useDashboardLayout`: `nextGateState` is the entire decision the hook
 * makes on each poll tick, with no DOM or timer involved, and that is what
 * gets exercised here.
 *
 * The proof this ticket asks for is a real revoke feeding that function, not
 * a synthetic boolean: same temp-HOME + fixture-credential + session-cookie
 * pattern as session.test.ts (T1), then `getCredentialStore().remove(...)`,
 * then `verifySession` on the same cookie — which is exactly what
 * `GET /api/auth/session` (and therefore useAuthGate's poll) relies on.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

import {
  nextGateState,
  nextSeenAuthenticated,
  type AuthGateState,
  type AuthPollResult,
} from './useAuthGate.js';

type AuthModule = typeof import('./server/auth/session.js');
type StoreModule = typeof import('./server/auth/store.js');

const tmp = tempDir('auth-gate-');
const home = path.join(tmp, 'home');

let auth: AuthModule;
let store: StoreModule;
let cookieHeader: string;
let seenAfterLivePoll = false;

const CREDENTIAL_ID = 'auth-gate-test-credential';

function toCookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  assert.equal(os.homedir(), home);

  auth = await import('./server/auth/session.js');
  store = await import('./server/auth/store.js');

  await store.getCredentialStore().add({
    credentialId: CREDENTIAL_ID,
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'auth-gate-test-device',
    createdAt: new Date().toISOString(),
  });

  const setCookies = await auth.createSessionCookies({
    sub: CREDENTIAL_ID,
    device: 'auth-gate-test-device',
    iat: Math.floor(Date.now() / 1000),
  });
  cookieHeader = toCookieHeader(setCookies);
});

/**
 * Mirrors the hook's per-tick wiring: decide the next gate state with the
 * flag as it stood before this poll, then update the flag.
 */
function step(
  current: AuthGateState,
  seen: boolean,
  poll: AuthPollResult,
): { state: AuthGateState; seen: boolean } {
  return {
    state: nextGateState(current, poll, seen),
    seen: nextSeenAuthenticated(seen, poll),
  };
}

test('nextGateState: pure transition table', () => {
  assert.equal(nextGateState('ok', 'authenticated', false), 'ok');
  assert.equal(nextGateState('ok', 'authenticated', true), 'ok');
  assert.equal(nextGateState('ok', 'not-authenticated', true), 'signed-out');
  assert.equal(nextGateState('ok', 'not-authenticated', false), 'ok');
  assert.equal(nextGateState('ok', 'unknown', true), 'ok');
  assert.equal(nextGateState('ok', 'unknown', false), 'ok');
});

test('(a) never-authenticated visitor: repeated not-authenticated polls stay ok and never arm the flag', () => {
  let s = { state: 'ok' as AuthGateState, seen: false };
  for (let i = 0; i < 5; i += 1) {
    s = step(s.state, s.seen, 'not-authenticated');
    assert.equal(s.state, 'ok');
    assert.equal(s.seen, false);
  }
});

test('(b) authenticated then not-authenticated: gate flips to signed-out', () => {
  let s = { state: 'ok' as AuthGateState, seen: false };
  s = step(s.state, s.seen, 'authenticated');
  assert.deepEqual(s, { state: 'ok', seen: true });
  s = step(s.state, s.seen, 'not-authenticated');
  assert.equal(s.state, 'signed-out');
});

test('(b2) visitor who signs in later arms the gate, and a later revoke then triggers signed-out', () => {
  let s = { state: 'ok' as AuthGateState, seen: false };
  s = step(s.state, s.seen, 'not-authenticated');
  s = step(s.state, s.seen, 'not-authenticated');
  assert.deepEqual(s, { state: 'ok', seen: false });
  s = step(s.state, s.seen, 'authenticated');
  assert.deepEqual(s, { state: 'ok', seen: true });
  s = step(s.state, s.seen, 'not-authenticated');
  assert.equal(s.state, 'signed-out');
});

test("(c) 'unknown' never changes state and never arms the flag", () => {
  // Does not arm: an unknown poll before any authenticated poll leaves the
  // flag false, so a following not-authenticated still stays ok.
  let s = { state: 'ok' as AuthGateState, seen: false };
  s = step(s.state, s.seen, 'unknown');
  assert.deepEqual(s, { state: 'ok', seen: false });
  s = step(s.state, s.seen, 'not-authenticated');
  assert.deepEqual(s, { state: 'ok', seen: false });

  // Does not change state or the flag once armed.
  s = { state: 'ok', seen: true };
  s = step(s.state, s.seen, 'unknown');
  assert.deepEqual(s, { state: 'ok', seen: true });

  assert.equal(nextSeenAuthenticated(false, 'unknown'), false);
  assert.equal(nextSeenAuthenticated(true, 'unknown'), true);
  assert.equal(nextSeenAuthenticated(true, 'not-authenticated'), true);
  assert.equal(nextSeenAuthenticated(false, 'authenticated'), true);
});

test("(d) 'signed-out' stays terminal for every poll result and flag value", () => {
  // Once signed-out, a later successful poll never resurrects the hook within
  // the same lifetime — the comment in useAuthGate.ts explains why (re-auth
  // reloads the page instead, starting a fresh hook instance).
  const polls: AuthPollResult[] = ['authenticated', 'not-authenticated', 'unknown'];
  for (const poll of polls) {
    for (const seen of [true, false]) {
      assert.equal(nextGateState('signed-out', poll, seen), 'signed-out');
    }
  }
});

test('a live credential: the session this device would poll with still verifies — gate stays ok and arms', async () => {
  const session = await auth.verifySession(cookieHeader);
  assert.ok(session, 'expected the still-registered credential to verify');
  const poll: AuthPollResult = session !== null ? 'authenticated' : 'not-authenticated';
  const s = step('ok', false, poll);
  assert.deepEqual(s, { state: 'ok', seen: true });
  seenAfterLivePoll = s.seen;
});

test('T3: after a real revoke, the same cookie fails verifySession — gate flips to signed-out', async () => {
  const removed = await store.getCredentialStore().remove(CREDENTIAL_ID);
  assert.equal(removed, true);

  // This is exactly what GET /api/auth/session does with the cookie header
  // on the device's next poll tick: verifySession -> null -> 401 -> the
  // hook's pollAuthStatus() resolves 'not-authenticated'.
  const session = await auth.verifySession(cookieHeader);
  assert.equal(session, null, 'expected the revoked credential to fail verifySession (T1)');
  const poll: AuthPollResult = session !== null ? 'authenticated' : 'not-authenticated';
  // The device was seen authenticated by the earlier live-credential poll
  // (tests in this file run sequentially), so the revoke now signs it out.
  assert.equal(seenAfterLivePoll, true);
  assert.equal(nextGateState('ok', poll, seenAfterLivePoll), 'signed-out');
  // And a visitor who was never authenticated is not blocked by the same poll.
  assert.equal(nextGateState('ok', poll, false), 'ok');
});
