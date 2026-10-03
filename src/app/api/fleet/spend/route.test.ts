/**
 * SAM — GET /api/fleet/spend route test (T20b, Must 19, check 13).
 *
 * Before this ticket, `?demo=1` was silently ignored — the route always
 * scanned the live job store. This test proves that bug first (the "before"
 * assertions below show the live scan's own job/cost counts coming back
 * even with `demo=1`), then (after the fix) asserts the demo-mode figures
 * come from `demoFleetSpend` instead, so a client screen-share never shows
 * Colin's real spend.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type SpendRoute = typeof import('./route.js');
type AuthModule = typeof import('../../../../lib/server/auth/session.js');
type FleetSpend = import('../../../../types/fleet.js').FleetSpend;

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-route-'));
process.env.HOME = tmpHome;

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');

function writeMeta(id: string, meta: Record<string, unknown>): void {
  const dir = path.join(JOBS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

let spendRoute: SpendRoute;
let sessionCookie = '';

before(async () => {
  // Exactly one live fleet job — a count that can never coincide with
  // demoFleetSpend's fixed, invented totals, so whichever figure comes back
  // tells us which code path answered.
  writeMeta('job-live-hephaestus', {
    id: 'job-live-hephaestus',
    command: 'fleet:hephaestus (sonnet) — Example Co prototype site',
    status: 'exited',
    exitCode: 0,
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });

  const auth: AuthModule = await import('../../../../lib/server/auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  spendRoute = await import('./route.js');
});

function get(path: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, { headers });
}

test('GET /api/fleet/spend?demo=1 never reads the live job store (Must 19)', async () => {
  const res = await spendRoute.GET(get('/api/fleet/spend?demo=1', sessionCookie));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: FleetSpend };

  // The live scan would report exactly one scanned job (the fixture above);
  // demo mode must report the demo fixture's own fixed total instead.
  assert.notEqual(body.data.scannedJobs, 1, 'demo=1 must not return the live scan\'s job count');
  assert.equal(body.data.scannedJobs, 20, 'demo=1 must return demoFleetSpend\'s invented total');
  assert.equal(body.data.personas.hephaestus?.jobs, 4, 'demo=1 must return the invented per-persona figures');

  // The live fixture's brief text must never reach a demo response.
  const serialised = JSON.stringify(body.data);
  assert.ok(!serialised.includes('Example Co'), 'no live command text leaks into the demo payload');
});

test('GET /api/fleet/spend (no demo param) still scans the live job store', async () => {
  const res = await spendRoute.GET(get('/api/fleet/spend', sessionCookie));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: FleetSpend };
  assert.equal(body.data.scannedJobs, 1, 'the live fixture is still scanned when demo is off');
});
