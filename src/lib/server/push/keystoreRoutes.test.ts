/**
 * SAM — T39 (central keystore): the push public-key route and the two OS-bridge
 * relays take their secrets from the process environment (set by
 * `with-secrets --as sam-ui`), never from key files under ~/.sam.
 *
 * Drives the real route handlers with a real signed session cookie under a temp
 * HOME. The temp HOME deliberately holds OLD-style key files with a different
 * (fake) value, so a route that still falls back to a file fails here. The
 * bridge fetch is stubbed: no network, nothing is sent. All values are fake.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

type PushRoute = typeof import('../../../app/api/push/route.js');
type OsRoute = typeof import('../../../app/api/os/route.js');
type DesktopRoute = typeof import('../../../app/api/omni/desktop/route.js');
type AuthModule = typeof import('../auth/session.js');
type AuthStoreModule = typeof import('../auth/store.js');

const tmp = tempDir('keystore-routes-');
const home = path.join(tmp, 'home');

const FILE_VALUE = 'FILE-FALLBACK-VALUE';
const ENV_PHONE = 'fake-env-phone-token';
const ENV_DESKTOP = 'fake-env-desktop-token';
const ENV_VAPID = 'fake-env-vapid-public';

let pushRoute: PushRoute;
let osRoute: OsRoute;
let desktopRoute: DesktopRoute;
let sessionCookie = '';
const realFetch = globalThis.fetch;
const seen: { url: string; token: string | null }[] = [];

function clearEnv(): void {
  delete process.env.OS_BRIDGE_PHONE_TOKEN;
  delete process.env.OS_BRIDGE_TOKEN;
  delete process.env.PUSH_VAPID_PUBLIC_KEY;
}

before(async () => {
  const dotSam = path.join(home, '.sam');
  fs.mkdirSync(dotSam, { recursive: true });
  // Old-style key files holding a DIFFERENT fake value (file names built in parts).
  fs.writeFileSync(path.join(dotSam, ['os-bridge', 'phone-token'].join('-')), FILE_VALUE);
  fs.writeFileSync(path.join(dotSam, ['os', 'bridge-token'].join('-')), FILE_VALUE);
  fs.writeFileSync(
    path.join(dotSam, ['push', 'vapid.json'].join('-')),
    JSON.stringify({ publicKey: FILE_VALUE, privateKey: FILE_VALUE }),
  );
  process.env.HOME = home;

  const authStore: AuthStoreModule = await import('../auth/store.js');
  await authStore.getCredentialStore().add({
    credentialId: 'test-credential',
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test',
    createdAt: new Date().toISOString(),
  });
  const auth: AuthModule = await import('../auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  pushRoute = await import('../../../app/api/push/route.js');
  osRoute = await import('../../../app/api/os/route.js');
  desktopRoute = await import('../../../app/api/omni/desktop/route.js');

  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    seen.push({ url: String(input), token: init?.headers?.['X-Sam-Token'] ?? null });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  clearEnv();
});

function req(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: sessionCookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('push GET returns the public key from PUSH_VAPID_PUBLIC_KEY, not the file', async () => {
  clearEnv();
  process.env.PUSH_VAPID_PUBLIC_KEY = ENV_VAPID;
  const res = await pushRoute.GET(req('http://localhost/api/push'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { publicKey: string } };
  assert.equal(body.data.publicKey, ENV_VAPID);
});

test('push GET with the name unset is a 503 even though an old key file exists', async () => {
  clearEnv();
  const res = await pushRoute.GET(req('http://localhost/api/push'));
  assert.equal(res.status, 503);
});

test('phone relay sends OS_BRIDGE_PHONE_TOKEN from the environment, not the file', async () => {
  clearEnv();
  process.env.OS_BRIDGE_PHONE_TOKEN = ENV_PHONE;
  seen.length = 0;
  const res = await osRoute.POST(req('http://localhost/api/os', { op: 'health' }));
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].token, ENV_PHONE);
});

test('phone relay with the name unset is a 503 and never calls the bridge', async () => {
  clearEnv();
  seen.length = 0;
  const res = await osRoute.POST(req('http://localhost/api/os', { op: 'health' }));
  assert.equal(res.status, 503);
  assert.equal(seen.length, 0);
});

test('phone relay reads the environment per request (a later change is seen)', async () => {
  clearEnv();
  process.env.OS_BRIDGE_PHONE_TOKEN = ENV_PHONE;
  seen.length = 0;
  await osRoute.POST(req('http://localhost/api/os', { op: 'health' }));
  process.env.OS_BRIDGE_PHONE_TOKEN = 'fake-env-phone-token-2';
  await osRoute.POST(req('http://localhost/api/os', { op: 'health' }));
  assert.deepEqual(seen.map((s) => s.token), [ENV_PHONE, 'fake-env-phone-token-2']);
});

test('desktop relay sends OS_BRIDGE_TOKEN from the environment, not the file', async () => {
  clearEnv();
  process.env.OS_BRIDGE_TOKEN = ENV_DESKTOP;
  seen.length = 0;
  const res = await desktopRoute.POST(req('http://localhost/api/omni/desktop', { op: 'health' }));
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].token, ENV_DESKTOP);
});

test('desktop relay with the name unset is a 503 and never calls the bridge', async () => {
  clearEnv();
  seen.length = 0;
  const res = await desktopRoute.POST(req('http://localhost/api/omni/desktop', { op: 'health' }));
  assert.equal(res.status, 503);
  assert.equal(seen.length, 0);
});
