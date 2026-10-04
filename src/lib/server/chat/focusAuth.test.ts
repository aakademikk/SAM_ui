/**
 * SAM — review finding 9: two tabs or windows on ONE device must not
 * overwrite each other's "chat on screen" report.
 *
 * Before the fix, `POST /api/chats/focus` keyed `focus.ts`'s map by
 * `session.device` alone — two tabs on the same device (phone split-screen,
 * two PC windows) share one device name, so the second tab's heartbeat
 * silently replaced the first tab's entry. `tabId` folds a per-tab id into
 * the key, so each tab gets its own entry even though both calls carry the
 * exact same session (same device).
 *
 * Drives the real route handler with one real signed session cookie shared
 * by both "tabs", under a temp HOME so the signing key is throwaway.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type FocusRoute = typeof import('../../../app/api/chats/focus/route.js');
type FocusModule = typeof import('./focus.js');
type AuthModule = typeof import('../auth/session.js');
type AuthStoreModule = typeof import('../auth/store.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-auth-'));
const home = path.join(tmp, 'home');

let focusRoute: FocusRoute;
let focus: FocusModule;
let sessionCookie = '';

before(async () => {
  fs.mkdirSync(home, { recursive: true });
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

  focus = await import('./focus.js');
  focusRoute = await import('../../../app/api/chats/focus/route.js');
});

function post(body: unknown): Request {
  return new Request('http://localhost/api/chats/focus', {
    method: 'POST',
    headers: { cookie: sessionCookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('finding 9: two tabs on one device each keep their own chat on screen', async () => {
  focus.__resetFocusForTests();

  const chatA = '11111111-2222-3333-4444-555555555555';
  const chatB = '66666666-7777-8888-9999-000000000000';

  // Same device ("pc"), two different tabs — the exact scenario two PC
  // windows (or a phone split-screen) produce.
  const resA = await focusRoute.POST(post({ chatId: chatA, tabId: 'tab-1' }));
  assert.equal(resA.status, 200);
  const resB = await focusRoute.POST(post({ chatId: chatB, tabId: 'tab-2' }));
  assert.equal(resB.status, 200);

  // The bug: without tabId in the key, tab-2's report overwrites tab-1's
  // under the shared device key "pc", so chatA reads as off-screen here.
  assert.equal(focus.isOnScreen(chatA), true, 'tab-1 is still reporting chatA on screen');
  assert.equal(focus.isOnScreen(chatB), true, 'tab-2 is reporting chatB on screen');
});

test('a client with no tabId at all still gets the old one-entry-per-device behaviour', async () => {
  focus.__resetFocusForTests();
  const chatA = '11111111-2222-3333-4444-555555555555';
  const chatB = '66666666-7777-8888-9999-000000000000';

  await focusRoute.POST(post({ chatId: chatA }));
  assert.equal(focus.isOnScreen(chatA), true);

  // A second report with no tabId from the same device replaces the first,
  // same as before this fix — no tabId means no per-tab key to give it.
  await focusRoute.POST(post({ chatId: chatB }));
  assert.equal(focus.isOnScreen(chatA), false);
  assert.equal(focus.isOnScreen(chatB), true);
});

test('a null chatId report (tab navigated away) still clears only that tab', async () => {
  focus.__resetFocusForTests();
  const chatA = '11111111-2222-3333-4444-555555555555';

  await focusRoute.POST(post({ chatId: chatA, tabId: 'tab-1' }));
  await focusRoute.POST(post({ chatId: chatA, tabId: 'tab-2' }));
  assert.equal(focus.isOnScreen(chatA), true);

  await focusRoute.POST(post({ chatId: null, tabId: 'tab-1' }));
  // tab-2 is still looking at chatA, so it must still read as on screen.
  assert.equal(focus.isOnScreen(chatA), true);
});
