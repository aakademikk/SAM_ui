/**
 * SAM — review finding 11: the job output stream must not close a
 * still-running `sam-job` job as "killed".
 *
 * `GET /api/jobs/[id]/stream`'s orphan rule is "status says running, but
 * nothing in this process has it live" — correct for a JobManager-spawned
 * job surviving a restart, wrong for a sam-job job, which this process
 * never spawns at all (sam-job runs its own `systemd-run`): `manager.isLive`
 * is always false for one, running or not. Before the fix, opening a
 * perfectly healthy sam-job job's output page closed it as "killed" on the
 * first connect.
 *
 * Drives the real route handler with a real signed session cookie, under a
 * temp HOME so the job store and signing key are both throwaway. The job
 * directory is fabricated by hand (same meta shape readFrames.test.ts uses)
 * rather than actually spawning a job — `getJobManager()` is only ever
 * called here AFTER the fabricated directory is written, so its one-time
 * boot sweep (`reconcileOrphans`, which only matters for a job that was
 * already running at the moment of a restart) never sees it and never
 * rewrites its status — exactly like a sam-job job started normally, well
 * after the server has been up for a while.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

type StreamRoute = typeof import('../../../app/api/jobs/[id]/stream/route.js');
type ManagerModule = typeof import('./manager.js');
type AuthModule = typeof import('../auth/session.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-orphan-'));
const home = path.join(tmp, 'home');

let streamRoute: StreamRoute;
let manager: ManagerModule;
let sessionCookie = '';

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;

  const auth: AuthModule = await import('../auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'test-pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  manager = await import('./manager.js');
  streamRoute = await import('../../../app/api/jobs/[id]/stream/route.js');

  // Forces the JobManager singleton to construct NOW, while JOBS_ROOT does
  // not exist yet, so its one-time boot sweep (reconcileOrphans) finds
  // nothing and finishes immediately. Without this, the first test's own
  // fabricated "running" sam-job directory would race that sweep — which
  // treats any 'running' record with no pid as a dead process and rewrites
  // it to 'killed' — and could lose that race before the route ever reads it.
  manager.getJobManager();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

after(() => {
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function jobDir(id: string): string {
  const dir = path.join(home, '.sam', 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** sam-job's own meta shape (see /home/col/.local/bin/sam-job): `unit` and
 *  no `lastSeq` at all. `status: 'running'` with no `pid` — sam-job never
 *  records one, this process never spawned it. */
function writeSamJobMeta(id: string, dir: string): void {
  const meta = {
    id,
    command: 'node long-task.js',
    status: 'running',
    exitCode: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    outputBytes: 0,
    unit: `sam-job-x-${Date.now()}`,
    notify: false,
    summary: null,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'stdout.log'), 'still working...\n');
}

/** Reads SSE text off the route's response for `windowMs`, then aborts the
 *  request (triggering the route's own cleanup) so the test leaves no live
 *  poll interval behind. */
async function readStreamFor(response: Response, abort: AbortController, windowMs: number): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + windowMs;
  try {
    while (Date.now() < deadline) {
      const timeout = new Promise<{ done: true; value?: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true }), Math.max(0, deadline - Date.now())),
      );
      const result = await Promise.race([reader.read(), timeout]);
      if (result.done) break;
      text += decoder.decode(result.value, { stream: true });
    }
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
  }
  return text;
}

test('finding 11: a still-running sam-job job is not closed as "killed" on first connect', async () => {
  const id = `job_samjob_${Date.now()}`;
  const dir = jobDir(id);
  writeSamJobMeta(id, dir);

  const controller = new AbortController();
  const request = new Request(`http://localhost/api/jobs/${id}/stream`, {
    headers: { cookie: sessionCookie },
    signal: controller.signal,
  });
  const response = await streamRoute.GET(request, { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);

  const text = await readStreamFor(response, controller, 350);

  assert.ok(text.includes('event: meta'), 'expected at least the initial meta event');
  assert.ok(
    !text.includes('"status":"killed"'),
    `a running sam-job job must not be closed as killed; got:\n${text}`,
  );
});

test('a JobManager-style job claiming "running" with no live process IS still closed as killed (orphan rule still works for non-sam-job jobs)', async () => {
  const id = `job_${Date.now()}_managerstyle`;
  const dir = jobDir(id);
  const meta = {
    id,
    command: 'node build.js',
    status: 'running',
    exitCode: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    outputBytes: 0,
    lastSeq: 0,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'stdout.log'), '');

  const controller = new AbortController();
  const request = new Request(`http://localhost/api/jobs/${id}/stream`, {
    headers: { cookie: sessionCookie },
    signal: controller.signal,
  });
  const response = await streamRoute.GET(request, { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);

  const text = await readStreamFor(response, controller, 350);
  assert.ok(text.includes('"status":"killed"'), `expected the orphan rule to still fire; got:\n${text}`);
});
