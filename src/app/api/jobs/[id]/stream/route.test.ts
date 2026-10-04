/**
 * SAM — T2 (spec open question 2): a job's output stream must stop for a
 * device revoked mid-stream, even though the job itself keeps running.
 *
 * Before this fix, `GET /api/jobs/[id]/stream` checked `requireSession` once
 * at connect time and then polled job state forever via `setInterval`
 * without ever re-checking auth. A credential revoked after the stream
 * opened did nothing — the stream kept delivering output for up to the
 * cookie's full remaining lifetime. The spec's resolution: the job is not
 * owned by any device's session and must keep running server-side; only
 * *this device's view* of it has to cut off, within one poll interval.
 *
 * Same fixture pattern as streamOrphan.test.ts: a real signed session
 * cookie against a temp HOME, and a hand-fabricated sam-job-shaped job
 * directory (status: running, `unit` field, no `pid`, no `lastSeq`) so the
 * orphan-liveness check (`manager.isLive`, always false for a job this
 * process never spawned) never fires and the only thing that can close the
 * stream is the new auth re-check this ticket adds.
 *
 * Since T1, `requireSession` fails closed unless the credential is actually
 * registered in the store before the cookie is minted — so the credential
 * is added via `getCredentialStore().add(...)` first, exactly like
 * session.test.ts and streamOrphan.test.ts do.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

type StreamRoute = typeof import('./route.js');
type ManagerModule = typeof import('../../../../../lib/server/jobs/manager.js');
type AuthModule = typeof import('../../../../../lib/server/auth/session.js');
type AuthStoreModule = typeof import('../../../../../lib/server/auth/store.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-revoke-'));
const home = path.join(tmp, 'home');

const CREDENTIAL_ID = 'test-credential';

let streamRoute: StreamRoute;
let manager: ManagerModule;
let authStore: AuthStoreModule;
let sessionCookie = '';

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;

  authStore = await import('../../../../../lib/server/auth/store.js');
  await authStore.getCredentialStore().add({
    credentialId: CREDENTIAL_ID,
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test-device',
    createdAt: new Date().toISOString(),
  });

  const auth: AuthModule = await import('../../../../../lib/server/auth/session.js');
  const cookies = await auth.createSessionCookies({
    sub: CREDENTIAL_ID,
    device: 'test-device',
    iat: 0,
  });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  manager = await import('../../../../../lib/server/jobs/manager.js');
  streamRoute = await import('./route.js');

  // Force the JobManager singleton to construct now, before the fabricated
  // job directories below exist, so its one-time boot sweep (reconcileOrphans)
  // finds nothing and can't race rewriting a fabricated "running" record —
  // same reasoning as streamOrphan.test.ts.
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

/** sam-job's own meta shape: `unit` and no `lastSeq`/`pid` at all. Keeps the
 *  stream route's orphan-liveness check from ever firing (isSamJob === true),
 *  so nothing but the new auth re-check can close this stream. */
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

const TIMEOUT = Symbol('timeout');

/**
 * Pumps a stream's reader across multiple timed windows without ever
 * abandoning a pending `reader.read()` call.
 *
 * A naive `Promise.race([reader.read(), timeout])` per window is a trap: when
 * the timeout wins, the `reader.read()` call it raced against is still
 * outstanding — reader.read() was never told to stop waiting. The next
 * window's helper call then issues a SECOND `reader.read()`, so two reads are
 * now queued on the same reader. The stream's next chunk resolves the first
 * (abandoned, unawaited) one and is silently dropped; only the chunk after
 * that reaches the second (awaited) one. Concretely, this ate the
 * `event: closed` line and surfaced only the `data: {"status":...}` line that
 * followed it — not a route bug, a test artefact.
 *
 * The fix: keep exactly one pending read alive across calls, reusing it
 * (never discarding it) when a window's timeout fires first.
 */
function makeStreamPump(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  return async function pump(windowMs: number): Promise<{ text: string; closed: boolean }> {
    let text = '';
    let closed = false;
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now());
      if (!pendingRead) pendingRead = reader.read();
      const result = await Promise.race([
        pendingRead,
        new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), remaining)),
      ]);
      if (result === TIMEOUT) break;
      // This read settled — clear it so the next iteration (or the next
      // call to this pump, in a later window) issues a fresh one instead of
      // racing an already-consumed promise.
      pendingRead = null;
      const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
      if (done) {
        closed = true;
        break;
      }
      if (value) text += decoder.decode(value, { stream: true });
    }
    return { text, closed };
  };
}

test('T2: a device revoked mid-stream stops receiving output, but the job keeps running', async () => {
  const id = `job_samjob_revoke_${Date.now()}`;
  const dir = jobDir(id);
  writeSamJobMeta(id, dir);

  const controller = new AbortController();
  const request = new Request(`http://localhost/api/jobs/${id}/stream`, {
    headers: { cookie: sessionCookie },
    signal: controller.signal,
  });
  const response = await streamRoute.GET(request, { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);

  const reader = response.body!.getReader();
  const pump = makeStreamPump(reader);

  try {
    // Phase 1: valid session — confirm the stream delivers meta + output
    // normally, same as before this ticket's change.
    const phase1 = await pump(150);
    assert.ok(phase1.text.includes('event: meta'), `expected a meta event; got:\n${phase1.text}`);
    assert.ok(
      phase1.text.includes('still working'),
      `expected the fabricated log output to be delivered; got:\n${phase1.text}`,
    );
    assert.ok(!phase1.closed, 'stream must not close while the session is still valid');

    // Revoke the credential — simulates `DELETE /api/auth/devices` firing
    // mid-stream, same as T1's test does to session.ts directly.
    const removed = await authStore.getCredentialStore().remove(CREDENTIAL_ID);
    assert.equal(removed, true, 'the credential must actually be removed from the store');

    // Phase 2: the next poll tick (every 100ms) must now re-check auth, find
    // it gone, and close the stream — well within this window.
    const phase2 = await pump(1000);
    const combined = phase1.text + phase2.text;

    assert.ok(
      combined.includes('event: closed'),
      `expected the stream to close after revocation; got:\n${combined}`,
    );
    assert.ok(
      combined.includes('"status":"unauthorized"'),
      `expected the closed event to report unauthorized; got:\n${combined}`,
    );

    // The job itself is server-side state, not owned by this device's
    // session — revoking the device must not touch it. Read fresh from disk
    // (this fabricated job was never registered with the live manager), so
    // this proves the route's new auth check did not reach into JobManager.
    const stillRunning = await manager.getJobManager().get(id);
    assert.ok(stillRunning, 'the job record must still exist');
    assert.equal(stillRunning?.status, 'running', 'the underlying job must still be running, untouched by the revoke');
    assert.equal(stillRunning?.exitCode, null);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});

test('T2: a never-revoked session is unaffected by the new re-check (common case)', async () => {
  // The previous test revoked CREDENTIAL_ID — re-register it so this test's
  // session cookie (minted once, in `before`, against the same credential
  // ID) is genuinely valid again, isolating this test from the previous
  // one's revocation.
  await authStore.getCredentialStore().add({
    credentialId: CREDENTIAL_ID,
    publicKey: new Uint8Array([1, 2, 3, 4]),
    counter: 0,
    transports: ['internal'],
    deviceName: 'test-device',
    createdAt: new Date().toISOString(),
  });

  const id = `job_samjob_valid_${Date.now()}`;
  const dir = jobDir(id);
  writeSamJobMeta(id, dir);

  const controller = new AbortController();
  const request = new Request(`http://localhost/api/jobs/${id}/stream`, {
    headers: { cookie: sessionCookie },
    signal: controller.signal,
  });
  const response = await streamRoute.GET(request, { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);

  const reader = response.body!.getReader();
  const pump = makeStreamPump(reader);

  try {
    // Span several poll ticks (100ms each) without ever revoking — the
    // `requireSession` re-check must pass every time and never close the
    // stream on its own.
    const result = await pump(350);
    assert.ok(result.text.includes('event: meta'), `expected a meta event; got:\n${result.text}`);
    assert.ok(
      !result.text.includes('event: closed'),
      `a still-valid, still-running session must not be closed; got:\n${result.text}`,
    );
    assert.ok(!result.closed, 'stream must still be open for a valid session');
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});
