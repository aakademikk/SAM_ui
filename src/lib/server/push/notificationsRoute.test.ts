/**
 * SAM — review finding 13, route layer: `GET /api/notifications?n=<id>`
 * stitches in an entry that has aged off the default newest-200 page, so the
 * page that id's own link points at (`/notifications?n=<id>`) can still find
 * it by id and highlight it.
 *
 * Drives the real route handler with a real signed session cookie, under a
 * temp HOME so the signing key and push log are both throwaway.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type NotificationsRoute = typeof import('../../../app/api/notifications/route.js');
type AuthModule = typeof import('../auth/session.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notifications-route-'));
const home = path.join(tmp, 'home');
const logFile = path.join(tmp, 'push-log.jsonl');

let notificationsRoute: NotificationsRoute;
let sessionCookie = '';

function entry(id: string, ts: number) {
  return { id, ts, title: `Title ${id}`, body: '', url: `/notifications?n=${id}`, tag: 'sam', chatId: null, jobId: null };
}

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.SAM_PUSH_LOG = logFile;

  const lines = Array.from({ length: 250 }, (_, i) => JSON.stringify(entry(`n_${i + 1}`, i + 1)));
  fs.writeFileSync(logFile, lines.join('\n') + '\n');

  const auth: AuthModule = await import('../auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  notificationsRoute = await import('../../../app/api/notifications/route.js');
});

function get(qs = ''): Request {
  return new Request(`http://localhost/api/notifications${qs}`, {
    headers: { cookie: sessionCookie },
  });
}

test('finding 13: ?n=<id> for an id outside the default page stitches it into the response', async () => {
  const plain = await notificationsRoute.GET(get());
  const plainBody = (await plain.json()) as { data: { id: string }[] };
  assert.equal(plainBody.data.length, 200);
  assert.equal(plainBody.data.some((e) => e.id === 'n_1'), false, 'n_1 is off the default page');

  const withN = await notificationsRoute.GET(get('?n=n_1'));
  const withNBody = (await withN.json()) as { data: { id: string }[] };
  assert.equal(withNBody.data.some((e) => e.id === 'n_1'), true, 'n_1 must be present when asked for by n=');
});

test('?n=<id> already on the default page changes nothing (no duplicate)', async () => {
  const res = await notificationsRoute.GET(get('?n=n_250'));
  const body = (await res.json()) as { data: { id: string }[] };
  assert.equal(body.data.length, 200);
  assert.equal(body.data.filter((e) => e.id === 'n_250').length, 1);
});

test('?n=<id> that exists nowhere in the log changes nothing', async () => {
  const res = await notificationsRoute.GET(get('?n=does-not-exist'));
  const body = (await res.json()) as { data: { id: string }[] };
  assert.equal(body.data.length, 200);
});
