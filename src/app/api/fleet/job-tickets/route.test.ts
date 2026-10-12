/**
 * SAM — GET /api/fleet/job-tickets route test (job ticket panel T11).
 * Real handler, real signed session cookie, scratch HOME (same pattern as the
 * floor route test).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

type Route = typeof import('./route.js');
type AuthModule = typeof import('../../../../lib/server/auth/session.js');
type StoreModule = typeof import('../../../../lib/server/auth/store.js');

const tmpHome = tempDir('job-tickets-route-');
process.env.HOME = tmpHome;

const JOB_ID = 'job_ticket-fixture_20261009-000000';
let route: Route;
let sessionCookie = '';

before(async () => {
  const wt = path.join(tmpHome, 'wt');
  fs.mkdirSync(path.join(wt, 'implementation'), { recursive: true });
  fs.writeFileSync(
    path.join(wt, 'implementation', 'demo-tickets.md'),
    '## T1: First\nStatus: DONE\n\n## T2: Second\nStatus: TODO\n',
  );
  const dir = path.join(tmpHome, '.sam', 'jobs', JOB_ID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ status: 'running', closerCtx: { cwd: wt, task: 'build' } }));
  fs.writeFileSync(path.join(dir, 'brief.md'), 'Build implementation/demo-tickets.md');

  const store: StoreModule = await import('../../../../lib/server/auth/store.js');
  await store.getCredentialStore().add({
    credentialId: 'test-credential',
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test',
    createdAt: new Date().toISOString(),
  });
  const auth: AuthModule = await import('../../../../lib/server/auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  route = await import('./route.js');
});

function get(query: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost/api/fleet/job-tickets${query}`, { headers });
}

async function data(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json()) as { data: Record<string, unknown> }).data;
}

test('unauthenticated request is refused like the floor route', async () => {
  const res = await route.GET(get(`?jobId=${JOB_ID}`));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'Not authenticated. Log in first.');
});

test('authenticated request for a fixture ticket job returns the tickets payload', async () => {
  const res = await route.GET(get(`?jobId=${JOB_ID}`, sessionCookie));
  assert.equal(res.status, 200);
  const d = await data(res);
  assert.equal(d.mode, 'tickets');
  assert.equal(d.heading, '1 of 2 tickets done');
  assert.equal((d.tickets as unknown[]).length, 2);
});

test('missing, malformed or unknown jobId returns stages mode with status 200', async () => {
  for (const q of ['', '?jobId=', '?jobId=../../etc', '?jobId=job_does-not-exist']) {
    const res = await route.GET(get(q, sessionCookie));
    assert.equal(res.status, 200, q);
    assert.equal((await data(res)).mode, 'stages', q);
  }
});

test('demo=1 returns stages mode without touching the store', async () => {
  const jobsDir = path.join(tmpHome, '.sam', 'jobs');
  fs.renameSync(jobsDir, `${jobsDir}-hidden`);
  try {
    const res = await route.GET(get(`?jobId=${JOB_ID}&demo=1`, sessionCookie));
    assert.equal(res.status, 200);
    assert.deepEqual(await data(res), { mode: 'stages' });
  } finally {
    fs.renameSync(`${jobsDir}-hidden`, jobsDir);
  }
});
