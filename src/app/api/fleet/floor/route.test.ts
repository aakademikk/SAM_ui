/**
 * SAM — GET /api/fleet/floor route test.
 *
 * Drives the real route handler with a real signed session cookie, under a
 * temp HOME so the signing key and job store are both throwaway (same
 * pattern as `src/lib/server/push/notificationsRoute.test.ts`). Asserts the
 * JSON shape matches `FloorState` and that an unauthenticated call gets the
 * same failure shape `/api/fleet/jobs` returns today.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type FloorRoute = typeof import('./route.js');
type AuthModule = typeof import('../../../../lib/server/auth/session.js');
type FloorState = import('../../../../types/floor.js').FloorState;

// Route every ~/.sam path this test touches into a scratch HOME, set BEFORE
// the route (and the floorState module it imports) is loaded — JOBS_ROOT in
// floorState.ts and the session key path in auth/session.ts are both
// resolved from os.homedir() at module load time.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-route-'));
process.env.HOME = tmpHome;

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');

function jobDir(id: string): string {
  const dir = path.join(JOBS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMeta(id: string, meta: Record<string, unknown>): void {
  fs.writeFileSync(path.join(jobDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
}

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

let floorRoute: FloorRoute;
let sessionCookie = '';

before(async () => {
  // A couple of fixture jobs, a subset of T1's own fixtures: one placed
  // under a General via its `general` field, one left ungrouped under SAM.
  writeMeta('job-hephaestus-running', {
    id: 'job-hephaestus-running',
    command: 'claude -p "build the thing"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-60_000),
    startedAt: iso(-50_000),
    endedAt: null,
    general: 'hephaestus',
  });
  writeMeta('job-no-general', {
    id: 'job-no-general',
    command: 'claude -p "tidy the vault"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
  });

  const auth: AuthModule = await import('../../../../lib/server/auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  floorRoute = await import('./route.js');
});

function get(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request('http://localhost/api/fleet/floor', { headers });
}

test('GET /api/fleet/floor returns a FloorState shape for an authenticated session', async () => {
  const res = await floorRoute.GET(get(sessionCookie));
  assert.equal(res.status, 200);

  const body = (await res.json()) as { data: FloorState; meta: { source: string } };
  assert.equal(body.meta.source, 'sam.fleet.floor');

  const { data } = body;
  assert.ok(data.generals, 'FloorState must carry a generals map');
  for (const id of ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'] as const) {
    assert.ok(data.generals[id], `generals must include ${id}`);
    assert.equal(typeof data.generals[id].idle, 'boolean');
    assert.ok(Array.isArray(data.generals[id].workers));
  }
  assert.ok(Array.isArray(data.samWorkers));
  assert.ok(data.towers);
  assert.ok(Array.isArray(data.dispatchFlares));

  const hephaestusWorker = data.generals.hephaestus.workers.find(
    (w) => w.jobId === 'job-hephaestus-running',
  );
  assert.ok(hephaestusWorker, 'the fixture job placed under hephaestus must show up there');

  const samWorker = data.samWorkers.find((w) => w.jobId === 'job-no-general');
  assert.ok(samWorker, 'the fixture job with no General must show up under sam');
});

test('GET /api/fleet/floor with no session gets the same failure shape as /api/fleet/jobs', async () => {
  const res = await floorRoute.GET(get());
  assert.equal(res.status, 401);

  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'Not authenticated. Log in first.');
});
