/**
 * SAM — review finding 8 (route layer): `/api/chats/[id]` rejects a
 * non-UUID id outright, before it ever reaches the chat store.
 *
 * `chatStore.test.ts` already proves `getChat`/`update` themselves refuse
 * `__proto__`/`constructor` (the store-level guard). This is the second,
 * independent layer the review also asked for: the route checks the id's
 * shape itself (`validSessionId`), so a request for `/api/chats/__proto__`
 * never even calls into chatActions.
 *
 * Drives the real GET handler with a real signed session cookie, under a
 * temp HOME so the store is throwaway.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

type ChatRoute = typeof import('../../../app/api/chats/[id]/route.js');
type ChatStoreModule = typeof import('./chatStore.js');
type AuthModule = typeof import('../auth/session.js');
type AuthStoreModule = typeof import('../auth/store.js');

const tmp = tempDir('chat-id-auth-');
const home = path.join(tmp, 'home');

let chatRoute: ChatRoute;
let store: ChatStoreModule;
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

  store = await import('./chatStore.js');
  chatRoute = await import('../../../app/api/chats/[id]/route.js');
});

function get(id: string): Request {
  return new Request(`http://localhost/api/chats/${id}`, {
    headers: { cookie: sessionCookie },
  });
}

test('finding 8: GET /api/chats/__proto__ 404s without reaching the store', async () => {
  const res = await chatRoute.GET(get('__proto__'), { params: Promise.resolve({ id: '__proto__' }) });
  assert.equal(res.status, 404);
  assert.equal((Object.prototype as Record<string, unknown>).archived, undefined);
});

test('finding 8: GET /api/chats/constructor also 404s', async () => {
  const res = await chatRoute.GET(get('constructor'), { params: Promise.resolve({ id: 'constructor' }) });
  assert.equal(res.status, 404);
});

test('a real chat (well-formed UUID, a store record) still opens normally', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  store.createChat({ id, tier: 'max', account: 'main', firstMessage: 'hi', title: 'Hi' });

  const res = await chatRoute.GET(get(id), { params: Promise.resolve({ id }) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { chat: { id: string } } };
  assert.equal(body.data.chat.id, id);
});
