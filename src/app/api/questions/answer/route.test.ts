/**
 * SAM — POST /api/questions/answer.
 *
 * Drives the real route handler with real signed cookies, a fixture job store
 * (SAM_JOB_STORE) and the real closer_answer.py.next through the
 * SAM_CLOSER_ANSWER_PY seam, built into an overlay folder so its sibling
 * modules resolve. sam-dispatch and sam-push are stubs. Never ~/.sam/jobs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

const CLOSER = '/home/col/.sam/closer';

const tmp = tempDir('answer-route-');
const home = path.join(tmp, 'home');
const store = path.join(tmp, 'jobs');
const outside = path.join(tmp, 'outside');
const overlay = path.join(tmp, 'overlay');
const stub = path.join(tmp, 'stub.sh');

let route: typeof import('./route.js');
let sessionCookie = '';
let stepUpCookie = '';

const ORDINARY = 'q_aaaa1111';
const GATED = 'q_bbbb2222';
const CHOICE = 'q_cccc3333';

function question(id: string, gated: boolean, kind = 'yesno', options = ['Accept', 'Decline']) {
  return {
    id,
    kind,
    text: 'Question ' + id,
    options,
    source: 'test',
    gated,
    acceptAction: 'none',
    state: 'open',
    createdAt: '2026-10-09T00:00:00Z',
    answeredAt: null,
    answeredVia: null,
    result: null,
  };
}

function closerFile(job: string): string {
  return path.join(store, job, 'closer.json');
}

function writeJob(root: string, name: string) {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(
    path.join(root, name, 'closer.json'),
    JSON.stringify({
      questions: [question(ORDINARY, false), question(GATED, true), question(CHOICE, false, 'choice2', ['Red', 'Blue'])],
    }),
  );
}

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.SAM_JOB_STORE = store;

  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.SAM_DISPATCH_BIN = stub;
  process.env.SAM_PUSH_BIN = stub;

  // Overlay: the live closer modules, with each staged .next over its real name.
  fs.mkdirSync(overlay);
  for (const f of fs.readdirSync(CLOSER)) {
    if (f.endsWith('.py') || f === 'unblock-brief.md') fs.copyFileSync(path.join(CLOSER, f), path.join(overlay, f));
  }
  for (const f of fs.readdirSync(CLOSER)) {
    if (f.endsWith('.py.next')) fs.copyFileSync(path.join(CLOSER, f), path.join(overlay, f.slice(0, -5)));
  }
  if (fs.existsSync(path.join(CLOSER, 'unblock-brief.md.next'))) {
    fs.copyFileSync(path.join(CLOSER, 'unblock-brief.md.next'), path.join(overlay, 'unblock-brief.md'));
  }
  process.env.SAM_CLOSER_ANSWER_PY = path.join(overlay, 'closer_answer.py');

  writeJob(store, 'job_one');
  writeJob(store, 'job_two');
  writeJob(store, 'job_three');
  writeJob(store, 'job_four');
  writeJob(outside, 'job_out');
  fs.symlinkSync(path.join(outside, 'job_out'), path.join(store, 'job_link'));

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
  const pick = (name: string) => {
    const c = cookies.find((x) => x.startsWith(`${name}=`));
    assert.ok(c);
    return c.split(';')[0];
  };
  sessionCookie = pick(auth.SESSION_COOKIE);
  stepUpCookie = pick(auth.STEPUP_COOKIE);

  route = await import('./route.js');
});

function post(body: unknown, opts: { cookie?: string; site?: string; via?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.site) headers['sec-fetch-site'] = opts.site;
  if (opts.via) headers['x-answer-via'] = opts.via;
  return new Request('http://localhost/api/questions/answer', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const sessionOnly = () => sessionCookie;
const withStepUp = () => `${sessionCookie}; ${stepUpCookie}`;

test('no cookie gives 401 and nothing is touched', async () => {
  const before = fs.readFileSync(closerFile('job_one'));
  const res = await route.POST(post({ jobId: 'job_one', questionId: ORDINARY, answer: 'a' }));
  assert.equal(res.status, 401);
  assert.deepEqual(fs.readFileSync(closerFile('job_one')), before);
});

test('a cross-site request is refused with 403 even with a session', async () => {
  const before = fs.readFileSync(closerFile('job_one'));
  const res = await route.POST(
    post({ jobId: 'job_one', questionId: ORDINARY, answer: 'a' }, { cookie: withStepUp(), site: 'cross-site' }),
  );
  assert.equal(res.status, 403);
  assert.deepEqual(fs.readFileSync(closerFile('job_one')), before);
});

test('bad jobId, job outside the store, unknown questionId and answer c change nothing', async () => {
  const before = fs.readFileSync(closerFile('job_one'));
  const outsideBefore = fs.readFileSync(path.join(outside, 'job_out', 'closer.json'));
  const cases: [Record<string, unknown>, number][] = [
    [{ jobId: '../x', questionId: ORDINARY, answer: 'a' }, 400],
    [{ jobId: 'job_one/../job_two', questionId: ORDINARY, answer: 'a' }, 400],
    [{ jobId: 'job_link', questionId: ORDINARY, answer: 'a' }, 404],
    [{ jobId: 'job_missing', questionId: ORDINARY, answer: 'a' }, 404],
    [{ jobId: 'job_one', questionId: 'q_deadbeef', answer: 'a' }, 404],
    [{ jobId: 'job_one', questionId: 'q_NOPE', answer: 'a' }, 400],
    [{ jobId: 'job_one', questionId: ORDINARY, answer: 'c' }, 400],
    [{ jobId: 'job_one', questionId: ORDINARY }, 400],
  ];
  for (const [body, status] of cases) {
    const res = await route.POST(post(body, { cookie: withStepUp() }));
    assert.equal(res.status, status, JSON.stringify(body));
  }
  assert.deepEqual(fs.readFileSync(closerFile('job_one')), before);
  assert.deepEqual(fs.readFileSync(path.join(outside, 'job_out', 'closer.json')), outsideBefore);
});

test('a gated question without step-up gives 401 stepUpRequired and is unchanged', async () => {
  const before = fs.readFileSync(closerFile('job_two'));
  const res = await route.POST(post({ jobId: 'job_two', questionId: GATED, answer: 'a' }, { cookie: sessionOnly() }));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { stepUpRequired?: boolean };
  assert.equal(body.stepUpRequired, true);
  assert.deepEqual(fs.readFileSync(closerFile('job_two')), before);
});

test('a gated question with step-up gives 200 with exactly the four keys', async () => {
  const res = await route.POST(post({ jobId: 'job_two', questionId: GATED, answer: 'a' }, { cookie: withStepUp() }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: Record<string, unknown> };
  assert.deepEqual(Object.keys(body.data).sort(), ['changed', 'questionId', 'result', 'state']);
  assert.equal(body.data.questionId, GATED);
  assert.equal(body.data.state, 'accepted');
  assert.equal(body.data.changed, true);
  const rec = JSON.parse(fs.readFileSync(closerFile('job_two'), 'utf8')) as { questions: { id: string; answeredVia: string }[] };
  assert.equal(rec.questions.find((q) => q.id === GATED)?.answeredVia, 'tab');
});

test('an ordinary question with a session only gives 200; a second answer is changed:false', async () => {
  const first = await route.POST(post({ jobId: 'job_three', questionId: ORDINARY, answer: 'b' }, { cookie: sessionOnly() }));
  assert.equal(first.status, 200);
  const one = (await first.json()) as { data: { state: string; changed: boolean } };
  assert.equal(one.data.state, 'declined');
  assert.equal(one.data.changed, true);

  const second = await route.POST(post({ jobId: 'job_three', questionId: ORDINARY, answer: 'a' }, { cookie: sessionOnly() }));
  assert.equal(second.status, 200);
  const two = (await second.json()) as { data: { state: string; changed: boolean } };
  assert.equal(two.data.changed, false);
  assert.equal(two.data.state, 'declined');
});

test('the x-answer-via push header is recorded, and a choice2 answer names its label', async () => {
  const res = await route.POST(
    post({ jobId: 'job_four', questionId: CHOICE, answer: 'b' }, { cookie: sessionOnly(), via: 'push' }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { result: string } };
  assert.equal(body.data.result, 'Chose Blue');
  const rec = JSON.parse(fs.readFileSync(closerFile('job_four'), 'utf8')) as { questions: { id: string; answeredVia: string }[] };
  assert.equal(rec.questions.find((q) => q.id === CHOICE)?.answeredVia, 'push');
});
