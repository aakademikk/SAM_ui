/**
 * SAM — review finding 2: the pre-upgrade chat adoption must land with only
 * a session, because a phone's step-up has usually lapsed (10 minutes) by
 * the time the first load after deploy runs `migrateLegacy` + adopt.
 * Without this, the device's current chat is imported into Archived instead
 * of sitting in the main list (spec 14, check 10a).
 *
 * Drives the real route handlers with a real signed session cookie (no
 * step-up cookie), under a temp HOME so the signing key, registry, store and
 * transcripts are all throwaway. Also pins that every other chat-write route
 * still demands step-up — only adopt moved.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

type AdoptRoute = typeof import('../../../app/api/chats/adopt/route.js');
type ChatRoute = typeof import('../../../app/api/chats/[id]/route.js');
type HandoffRoute = typeof import('../../../app/api/chats/[id]/handoff/route.js');
type AgentRoute = typeof import('../../../app/api/chat/agent/route.js');
type SessionsModule = typeof import('./samuiSessions.js');
type ChatStoreModule = typeof import('./chatStore.js');
type AuthStoreModule = typeof import('../auth/store.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-auth-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const pushSubs = path.join(tmp, 'push-subs.json');

let sessionCookie = '';
let adoptRoute: AdoptRoute;
let chatRoute: ChatRoute;
let handoffRoute: HandoffRoute;
let agentRoute: AgentRoute;
let sessions: SessionsModule;
let store: ChatStoreModule;

function post(url: string, body: unknown, method = 'POST'): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { cookie: sessionCookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A transcript the way a pre-upgrade device chat left it, registered as
 *  SAM_ui-owned, with no store record (same recipe as chatActions.test). */
function makeLegacyChat(id: string): void {
  const made = spawnSync(
    process.env.SAM_CLAUDE_BIN as string,
    ['-p', 'an old chat about the boiler', '--session-id', id],
    { cwd: agentDir, env: { ...process.env, FAKE_CLAUDE_DELAY_MS: '0' }, encoding: 'utf8' },
  );
  assert.equal(made.status, 0, made.stderr);
  sessions.registerSamuiSession(id);
}

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(pushSubs, '[]');
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  const authStore: AuthStoreModule = await import('../auth/store.js');
  await authStore.getCredentialStore().add({
    credentialId: 'test-credential',
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test',
    createdAt: new Date().toISOString(),
  });

  const auth = await import('../auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'test-phone', iat: 0 });
  // Session cookie only — stands in for a phone whose step-up has lapsed.
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  sessions = await import('./samuiSessions.js');
  store = await import('./chatStore.js');
  adoptRoute = await import('../../../app/api/chats/adopt/route.js');
  chatRoute = await import('../../../app/api/chats/[id]/route.js');
  handoffRoute = await import('../../../app/api/chats/[id]/handoff/route.js');
  agentRoute = await import('../../../app/api/chat/agent/route.js');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('finding 2: adopt succeeds with a session only, putting the device chat in the main list', async () => {
  const id = 'dddddddd-1111-2222-3333-444444444444';
  makeLegacyChat(id);

  const res = await adoptRoute.POST(post('/api/chats/adopt', { id }));
  assert.equal(res.status, 200, `adopt with a session only returned ${res.status}`);
  const chat = store.getChat(id);
  assert.ok(chat, 'the chat now has a store record');
  assert.equal(chat.archived, false, 'it is in the main list, not Archived');
});

test('finding 2: a session-only adopt also restores a chat the registry import already archived', async () => {
  const id = 'eeeeeeee-1111-2222-3333-444444444444';
  makeLegacyChat(id);
  // Stands in for T8's import having got there first.
  store.createChat({
    id,
    tier: 'max',
    account: 'main',
    firstMessage: 'an old chat about the boiler',
    title: 'Boiler',
    titleSource: 'fallback',
    archived: true,
  });

  const res = await adoptRoute.POST(post('/api/chats/adopt', { id }));
  assert.equal(res.status, 200);
  assert.equal(store.getChat(id)?.archived, false);
});

test('finding 2: session-level adopt still refuses an id SAM_ui does not own', async () => {
  const res = await adoptRoute.POST(post('/api/chats/adopt', { id: '99999999-1111-2222-3333-444444444444' }));
  assert.equal(res.status, 404);
});

test('finding 2: with no session at all, adopt is refused', async () => {
  const res = await adoptRoute.POST(
    new Request('http://localhost/api/chats/adopt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'dddddddd-1111-2222-3333-444444444444' }),
    }),
  );
  assert.equal(res.status, 401);
});

test('finding 2: every other chat-write route still requires step-up', async () => {
  const id = 'dddddddd-1111-2222-3333-444444444444';
  const params = { params: Promise.resolve({ id }) };
  const responses = [
    await chatRoute.PATCH(post(`/api/chats/${id}`, { action: 'archive' }, 'PATCH'), params),
    await chatRoute.DELETE(post(`/api/chats/${id}`, {}, 'DELETE'), params),
    await handoffRoute.POST(post(`/api/chats/${id}/handoff`, { tier: 'max' }), params),
    await agentRoute.POST(post('/api/chat/agent', { message: 'hi', tier: 'max', chatId: id })),
  ];
  for (const res of responses) {
    assert.equal(res.status, 401);
    const body = (await res.json()) as { stepUpRequired?: boolean };
    assert.equal(body.stepUpRequired, true);
  }
  // None of them touched the chat.
  assert.equal(store.getChat(id)?.archived, false);
});
