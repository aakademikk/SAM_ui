/**
 * SAM — POST/GET /api/pack/approve.
 *
 * Drives the real route handler with real signed cookies and the real
 * pack_approve.py, copied into an overlay folder and reached through the
 * SAM_PACK_APPROVE_PY seam. The approval and run-state files live in a temp
 * folder named by PF_PACK_DIR. Never the real Parkfords approval files.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { boxOnlySkip } from '@/lib/server/testing/boxOnly';
import { tempDir } from '@/lib/server/testing/tempDir';

const REAL_SCRIPT = '/home/col/timesheet-automation/work/parkfords-extract/pack_approve.py';
const SKIP = boxOnlySkip('the live pack_approve.py', [REAL_SCRIPT]);

const tmp = tempDir('pack-approve-route-');
const home = path.join(tmp, 'home');
const pack = path.join(tmp, 'pack');
const overlay = path.join(tmp, 'overlay');
const approvalFile = path.join(pack, 'pack-approval.json');

let route: typeof import('./route.js');
let sessionCookie = '';

const PENDING = 'q_aaaa1111';
const SENT = 'q_bbbb2222';
const UNKNOWN = 'q_deadbeef';

function readApprovals(): Record<string, { approved?: { via?: string; questionId?: string } }> {
  return JSON.parse(fs.readFileSync(approvalFile, 'utf8'));
}

before(async () => {
  if (SKIP) return;
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;

  fs.mkdirSync(pack);
  fs.writeFileSync(
    approvalFile,
    JSON.stringify({
      '2026-10-26': { pending: { fingerprint: 'fp-open', questionId: PENDING, count: 3, file: 'x.md', at: '2026-10-25T18:23:00', by: 'rehearsal' } },
      '2026-10-19': { pending: { fingerprint: 'fp-old', questionId: SENT, count: 1, file: 'y.md', at: '2026-10-18T18:23:00', by: 'rehearsal' } },
    }),
  );
  fs.writeFileSync(path.join(pack, 'invoice-pack-state.json'), JSON.stringify({ '2026-10-19': { status: 'sent' } }));
  process.env.PF_PACK_DIR = pack;

  fs.mkdirSync(overlay);
  fs.copyFileSync(REAL_SCRIPT, path.join(overlay, 'pack_approve.py'));
  process.env.SAM_PACK_APPROVE_PY = path.join(overlay, 'pack_approve.py');

  const authStore = await import('../../../../lib/server/auth/store.js');
  await authStore.getCredentialStore().add({
    credentialId: 'test-credential',
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test',
    createdAt: new Date().toISOString(),
  });
  const auth = await import('../../../../lib/server/auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const found = cookies.find((x) => x.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(found);
  sessionCookie = found.split(';')[0];

  route = await import('./route.js');
});

function post(body: unknown, opts: { cookie?: string; site?: string; via?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.site) headers['sec-fetch-site'] = opts.site;
  if (opts.via) headers['x-answer-via'] = opts.via;
  return new Request('http://localhost/api/pack/approve', { method: 'POST', headers, body: JSON.stringify(body) });
}

function get(questionId: string | null, cookie?: string): Request {
  const url = 'http://localhost/api/pack/approve' + (questionId === null ? '' : `?questionId=${questionId}`);
  return new Request(url, { method: 'GET', headers: cookie ? { cookie } : {} });
}

test('a cross-site request is refused with 403 even with a session, and nothing is recorded', { skip: SKIP }, async () => {
  const before = fs.readFileSync(approvalFile);
  const res = await route.POST(post({ questionId: PENDING }, { cookie: sessionCookie, site: 'cross-site' }));
  assert.equal(res.status, 403);
  assert.deepEqual(fs.readFileSync(approvalFile), before);
});

test('no session gives 401 and nothing is recorded', { skip: SKIP }, async () => {
  const before = fs.readFileSync(approvalFile);
  const res = await route.POST(post({ questionId: PENDING }));
  assert.equal(res.status, 401);
  assert.deepEqual(fs.readFileSync(approvalFile), before);
});

test('a bad or missing questionId gives 400 and nothing is recorded', { skip: SKIP }, async () => {
  const before = fs.readFileSync(approvalFile);
  const cases: unknown[] = [
    {},
    { questionId: 7 },
    { questionId: 'q_NOPE' },
    { questionId: 'q_aaaa1111; rm -rf /' },
    { questionId: '../q_aaaa1111' },
    { questionId: 'q_aaaa11111' },
  ];
  for (const body of cases) {
    const res = await route.POST(post(body, { cookie: sessionCookie }));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(fs.readFileSync(approvalFile), before);
});

test('an unknown question and a week already sent give 404 and nothing is recorded', { skip: SKIP }, async () => {
  const before = fs.readFileSync(approvalFile);
  for (const questionId of [UNKNOWN, SENT]) {
    const res = await route.POST(post({ questionId }, { cookie: sessionCookie }));
    assert.equal(res.status, 404, questionId);
  }
  assert.deepEqual(fs.readFileSync(approvalFile), before);
});

test('GET needs a session and a well-formed questionId', { skip: SKIP }, async () => {
  assert.equal((await route.GET(get(PENDING))).status, 401);
  assert.equal((await route.GET(get(null, sessionCookie))).status, 400);
  assert.equal((await route.GET(get('q_NOPE', sessionCookie))).status, 400);
});

test('GET on an open set says pending, with the envelope', { skip: SKIP }, async () => {
  const res = await route.GET(get(PENDING, sessionCookie));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { meta?: { source?: string }; data: Record<string, unknown> };
  assert.equal(body.meta?.source, 'sam.pack.approve');
  assert.deepEqual(body.data, { questionId: PENDING, state: 'pending' });
});

test('approve gives 200 with exactly the four keys and changed:true, recorded as push', { skip: SKIP }, async () => {
  const res = await route.POST(post({ questionId: PENDING }, { cookie: sessionCookie, via: 'push' }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { meta?: { source?: string }; data: Record<string, unknown> };
  assert.equal(body.meta?.source, 'sam.pack.approve');
  assert.deepEqual(Object.keys(body.data).sort(), ['changed', 'questionId', 'result', 'state']);
  assert.equal(body.data.questionId, PENDING);
  assert.equal(body.data.state, 'approved');
  assert.equal(body.data.changed, true);
  assert.match(String(body.data.result), /^Approved WC 26 Oct, 3 discrepancies\./);
  const approved = readApprovals()['2026-10-26'].approved;
  assert.equal(approved?.via, 'push');
  assert.equal(approved?.questionId, PENDING);
});

test('a second approve is changed:false, and GET now says approved', { skip: SKIP }, async () => {
  const again = await route.POST(post({ questionId: PENDING }, { cookie: sessionCookie }));
  assert.equal(again.status, 200);
  const body = (await again.json()) as { data: { state: string; changed: boolean } };
  assert.equal(body.data.state, 'approved');
  assert.equal(body.data.changed, false);
  assert.equal(readApprovals()['2026-10-26'].approved?.via, 'push');

  const status = await route.GET(get(PENDING, sessionCookie));
  const got = (await status.json()) as { data: { state: string } };
  assert.equal(got.data.state, 'approved');
});
