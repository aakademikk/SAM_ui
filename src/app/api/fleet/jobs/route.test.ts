/**
 * SAM — GET /api/fleet/jobs route test (T20b, Must 19, check 13).
 *
 * Same bug as `/api/fleet/spend`'s: before this ticket `?demo=1` was
 * silently ignored, so a client screen-share in demo mode would show a real
 * job's command text (which can carry a real client name — Must 19). This
 * test writes a live job whose command text stands in for that leak (an
 * obviously fake name, "Example Co" — never a real one), then asserts
 * `demo=1` never returns it, returning `demoFleetPersonaJobs`'s invented
 * list instead.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

type JobsRoute = typeof import('./route.js');
type AuthModule = typeof import('../../../../lib/server/auth/session.js');
type StoreModule = typeof import('../../../../lib/server/auth/store.js');
type FleetPersonaJob = import('../../../../types/fleet.js').FleetPersonaJob;

const tmpHome = tempDir('jobs-route-');
process.env.HOME = tmpHome;

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');
const AGENTS_DIR = path.join(tmpHome, '.claude', 'agents');

const LIVE_COMMAND = 'fleet:hephaestus (sonnet) — Example Co prototype site, three pages';

function writeMeta(id: string, meta: Record<string, unknown>): void {
  const dir = path.join(JOBS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

let jobsRoute: JobsRoute;
let sessionCookie = '';

before(async () => {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(AGENTS_DIR, 'hephaestus.md'),
    '---\nname: hephaestus\ndescription: Delivery\nmodel: sonnet\ntools: Read, Write\n---\nHephaestus.\n',
  );

  writeMeta('job-live-hephaestus', {
    id: 'job-live-hephaestus',
    command: LIVE_COMMAND,
    status: 'exited',
    exitCode: 0,
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });

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

  jobsRoute = await import('./route.js');
});

function get(path: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, { headers });
}

test('GET /api/fleet/jobs?persona=hephaestus&demo=1 never returns the live job\'s command text (Must 19)', async () => {
  const res = await jobsRoute.GET(get('/api/fleet/jobs?persona=hephaestus&demo=1', sessionCookie));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { persona: string; jobs: FleetPersonaJob[] } };

  assert.ok(!body.data.jobs.some((j) => j.id === 'job-live-hephaestus'), 'the live job must not appear in demo mode');
  const serialised = JSON.stringify(body.data);
  assert.ok(!serialised.includes('Example Co'), 'no live command text leaks into the demo payload');
  assert.ok(body.data.jobs.length > 0, 'demo mode still returns demoFleetPersonaJobs\'s invented history');
});

test('GET /api/fleet/jobs?persona=hephaestus (no demo param) still returns the live job', async () => {
  const res = await jobsRoute.GET(get('/api/fleet/jobs?persona=hephaestus', sessionCookie));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { persona: string; jobs: FleetPersonaJob[] } };
  assert.ok(body.data.jobs.some((j) => j.id === 'job-live-hephaestus'), 'the live fixture is still returned when demo is off');
});
