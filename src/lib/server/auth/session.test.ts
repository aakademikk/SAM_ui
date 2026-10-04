/**
 * SAM — T1 (must-do 18, 19; check 11): a revoked credential must fail every
 * session check immediately, not up to 30 days later.
 *
 * Before this fix, `verify()` only checked the JWT's signature and expiry —
 * it never asked the credential store whether the `sub` (credentialId) still
 * exists. A cookie minted before `DELETE /api/auth/devices` removed the
 * credential kept passing `verifySession`/`verifyStepUp` for the rest of its
 * natural life (up to SESSION_MAX_AGE, 30 days).
 *
 * Same temp-HOME pattern as adoptAuth.test.ts/focusAuth.test.ts/
 * chatStore.test.ts: HOME is pointed at a fresh temp dir *before* importing
 * session.ts/store.ts, since both resolve their on-disk paths (the JWT
 * signing key, credentials.json) from os.homedir() at module load / first
 * use. That keeps this test off Colin's real ~/.sam entirely.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type AuthModule = typeof import('./session.js');
type StoreModule = typeof import('./store.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-revoke-'));
const home = path.join(tmp, 'home');

let auth: AuthModule;
let store: StoreModule;

const CREDENTIAL_ID = 'test-credential-id';

/** Builds a raw "Cookie" request header from createSessionCookies' two
 *  Set-Cookie strings, pulling just the "name=value" part out of each. */
function toCookieHeader(setCookies: string[]): string {
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  assert.equal(os.homedir(), home);

  auth = await import('./session.js');
  store = await import('./store.js');

  await store.getCredentialStore().add({
    credentialId: CREDENTIAL_ID,
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test-device',
    createdAt: new Date().toISOString(),
  });
});

test('T1: a cookie pair for a credential still in the store passes both checks', async () => {
  const setCookies = await auth.createSessionCookies({
    sub: CREDENTIAL_ID,
    device: 'test-device',
    iat: Math.floor(Date.now() / 1000),
  });
  const cookieHeader = toCookieHeader(setCookies);

  const sessionPayload = await auth.verifySession(cookieHeader);
  assert.ok(sessionPayload, 'verifySession should pass while the credential exists');
  assert.equal(sessionPayload?.sub, CREDENTIAL_ID);

  const stepUpPayload = await auth.verifyStepUp(cookieHeader);
  assert.ok(stepUpPayload, 'verifyStepUp should pass while the credential exists');
  assert.equal(stepUpPayload?.sub, CREDENTIAL_ID);
});

test('T1: revoking the credential fails both checks immediately, for the same still-unexpired cookies', async () => {
  // Mint the pair while the credential still exists — same as any real
  // session in use at the moment of revocation.
  const setCookies = await auth.createSessionCookies({
    sub: CREDENTIAL_ID,
    device: 'test-device',
    iat: Math.floor(Date.now() / 1000),
  });
  const cookieHeader = toCookieHeader(setCookies);

  // Sanity: this exact cookie header is good before revocation (otherwise
  // the assertions below would be vacuously true for the wrong reason).
  assert.ok(await auth.verifySession(cookieHeader), 'sanity: session good before revoke');
  assert.ok(await auth.verifyStepUp(cookieHeader), 'sanity: step-up good before revoke');

  const removed = await store.getCredentialStore().remove(CREDENTIAL_ID);
  assert.equal(removed, true, 'the credential must actually be removed from the store');

  // This is the regression check: the JWTs themselves are untouched and
  // still well within their expiry window, so the only thing that can make
  // these fail is verify() consulting the credential store.
  const sessionPayload = await auth.verifySession(cookieHeader);
  assert.equal(sessionPayload, null, 'verifySession must fail closed once the credential is revoked');

  const stepUpPayload = await auth.verifyStepUp(cookieHeader);
  assert.equal(stepUpPayload, null, 'verifyStepUp must fail closed once the credential is revoked');
});

test('T1: verify() still fails closed for a credentialId that never existed', async () => {
  const setCookies = await auth.createSessionCookies({
    sub: 'never-registered-credential',
    device: 'test-device',
    iat: Math.floor(Date.now() / 1000),
  });
  const cookieHeader = toCookieHeader(setCookies);

  assert.equal(await auth.verifySession(cookieHeader), null);
  assert.equal(await auth.verifyStepUp(cookieHeader), null);
});
