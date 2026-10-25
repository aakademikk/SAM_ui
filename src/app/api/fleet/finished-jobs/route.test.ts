/**
 * SAM: GET /api/fleet/finished-jobs route test (completed-jobs T6, must-do
 * 17, check 7).
 *
 * A throwaway HOME holds a fixture store whose jobs carry an obviously fake,
 * recognisable name ("Example Co", never a real one). With `?demo=1`, on the
 * fleet form and the `?general=` form alike, none of that store's names or
 * ids may come back and no file under the store may be touched: every
 * `fs`/`fs.promises` call is spied for paths under it, and the finished-jobs
 * reads are mocked to fail loudly if the route calls them. Without `demo`,
 * the same store's rows come back. Unknown Generals (and `sam`, which has no
 * panel) are a 400; a request with no session is refused as
 * `/api/fleet/jobs` refuses it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { before, test, type TestContext } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';
import * as finishedJobs from '@/lib/server/fleet/finishedJobs';

type FinishedRoute = typeof import('./route.js');
type JobsRoute = typeof import('../jobs/route.js');
type AuthModule = typeof import('../../../../lib/server/auth/session.js');
type StoreModule = typeof import('../../../../lib/server/auth/store.js');
type FinishedJob = import('../../../../types/finishedJobs.js').FinishedJob;

const tmpHome = tempDir('finished-jobs-route-');
process.env.HOME = tmpHome;

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');
const LIVE_NAME = 'Example Co';

const HEPH_ID = 'job_example-co-site_20261020-080000';
const SAM_ID = 'job_example-co-note_20261020-081000';
const NULL_ID = 'job_example-co-deploy_20261020-082000';

/** A sam-job directory: `cmd.sh` plus `meta.json`. */
function samJob(id: string, meta: Record<string, unknown>): void {
  const dir = path.join(JOBS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cmd.sh'), `echo ${LIVE_NAME}\n`);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, ...meta }));
}

let finishedRoute: FinishedRoute;
let jobsRoute: JobsRoute;
let sessionCookie = '';

before(async () => {
  samJob(HEPH_ID, {
    general: 'hephaestus',
    summary: `${LIVE_NAME} prototype site`,
    command: `sam-job ${LIVE_NAME} build`,
    status: 'exited',
    exitCode: 0,
    endedAt: '2026-10-20T08:30:00.000Z',
  });
  fs.writeFileSync(
    path.join(JOBS_ROOT, HEPH_ID, 'closer.json'),
    JSON.stringify({ status: 'closed', verdictKind: 'pass', verdict: 'PASS (2/2 checks)' }),
  );
  samJob(SAM_ID, {
    general: 'sam',
    summary: `${LIVE_NAME} follow-up note`,
    status: 'failed',
    exitCode: 1,
    endedAt: '2026-10-20T08:40:00.000Z',
  });
  // No General: never listed, demo or not.
  samJob(NULL_ID, {
    general: null,
    summary: `${LIVE_NAME} deploy`,
    status: 'exited',
    exitCode: 0,
    endedAt: '2026-10-20T08:50:00.000Z',
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

  finishedRoute = await import('./route.js');
  jobsRoute = await import('../jobs/route.js');
});

function get(path: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, { headers });
}

const FSP_METHODS = ['open', 'readFile', 'readdir', 'stat', 'lstat', 'access', 'opendir'] as const;
const FS_METHODS = [
  'openSync',
  'readFileSync',
  'readdirSync',
  'statSync',
  'lstatSync',
  'accessSync',
  'existsSync',
  'opendirSync',
  'createReadStream',
] as const;

/**
 * Spies every file-access call on `fs` and `fs.promises` (passing it through)
 * and returns the paths touched under the fixture store.
 */
function spyStore(t: TestContext): string[] {
  const touched: string[] = [];
  const note = (p: unknown) => {
    const s = typeof p === 'string' ? p : p instanceof URL ? p.pathname : '';
    if (s.startsWith(JOBS_ROOT)) touched.push(s);
  };
  const wrap = (obj: object, name: string) => {
    const target = obj as Record<string, (...args: unknown[]) => unknown>;
    const original = target[name];
    t.mock.method(target, name, function (this: unknown, ...args: unknown[]) {
      note(args[0]);
      return original.apply(this, args);
    });
  };
  for (const name of FSP_METHODS) wrap(fsp, name);
  for (const name of FS_METHODS) wrap(fs, name);
  return touched;
}

/** Makes every finished-jobs read fail loudly, and returns its call counts. */
function forbidStoreReads(t: TestContext): () => number {
  const mocks = (['getFleetFinished', 'getGeneralFinished', 'scanFinishedJobs', 'attachVerdicts'] as const).map(
    (name) =>
      t.mock.method(finishedJobs, name, () => {
        throw new Error(`${name} must not be called in demo mode`);
      }),
  );
  return () => mocks.reduce((sum, m) => sum + m.mock.callCount(), 0);
}

async function jobsOf(res: Response): Promise<FinishedJob[]> {
  const body = (await res.json()) as { data: { jobs: FinishedJob[] }; meta: { source: string } };
  assert.equal(body.meta.source, 'sam.fleet.finished-jobs');
  return body.data.jobs;
}

test('check 7: ?demo=1 on the fleet form and the General form returns invented rows and never touches the store', async (t) => {
  finishedJobs.resetFinishedJobsCache();
  const touched = spyStore(t);
  const calls = forbidStoreReads(t);

  const fleetRes = await finishedRoute.GET(get('/api/fleet/finished-jobs?demo=1', sessionCookie));
  assert.equal(fleetRes.status, 200);
  const fleet = await jobsOf(fleetRes);
  assert.equal(fleet.length, 10, 'the demo fleet list is full');

  const generalRes = await finishedRoute.GET(
    get('/api/fleet/finished-jobs?general=hephaestus&demo=1', sessionCookie),
  );
  assert.equal(generalRes.status, 200);
  const general = await jobsOf(generalRes);
  assert.equal(general.length, 5, 'the demo General list is a full last five');
  assert.ok(general.every((j) => j.general === 'hephaestus'));

  const serialised = JSON.stringify([fleet, general]);
  assert.ok(!serialised.includes(LIVE_NAME), 'no name from the live store reaches a demo response');
  for (const id of [HEPH_ID, SAM_ID, NULL_ID]) assert.ok(!serialised.includes(id), `${id} is not in the demo response`);

  assert.deepEqual(touched, [], 'no file under the store is opened, listed or stat-ed');
  assert.equal(calls(), 0, 'the finished-jobs reads are never called');
  assert.equal(finishedJobs.finishedJobsTestHooks.cacheSize(), 0, 'nothing from the store is remembered');
});

test('without demo, the fleet form returns the fixture store\'s rows, with the closer verdict', async () => {
  finishedJobs.resetFinishedJobsCache();
  const res = await finishedRoute.GET(get('/api/fleet/finished-jobs', sessionCookie));
  assert.equal(res.status, 200);
  const jobs = await jobsOf(res);
  assert.deepEqual(
    jobs.map((j) => j.id),
    [SAM_ID, HEPH_ID],
    'the two counted jobs, newest finish first; the job with no General is left out',
  );
  const [sam, heph] = jobs;
  assert.equal(sam.general, 'sam');
  assert.equal(sam.outcome, 'failed');
  assert.equal(sam.verdict, null);
  assert.equal(heph.name, `${LIVE_NAME} prototype site`);
  assert.equal(heph.outcome, 'passed');
  assert.equal(heph.verdict, 'PASS (2/2 checks)');
});

test('without demo, the General form returns only that General\'s rows, never SAM\'s', async () => {
  finishedJobs.resetFinishedJobsCache();
  const heph = await jobsOf(
    await finishedRoute.GET(get('/api/fleet/finished-jobs?general=hephaestus', sessionCookie)),
  );
  assert.deepEqual(heph.map((j) => j.id), [HEPH_ID]);

  const hermes = await jobsOf(await finishedRoute.GET(get('/api/fleet/finished-jobs?general=hermes', sessionCookie)));
  assert.deepEqual(hermes, []);
});

test('an unknown General, sam or an empty value is a 400, with or without demo', async () => {
  for (const query of ['general=zeus', 'general=sam', 'general=', 'general=zeus&demo=1', 'general=sam&demo=1']) {
    const res = await finishedRoute.GET(get(`/api/fleet/finished-jobs?${query}`, sessionCookie));
    assert.equal(res.status, 400, `?${query} is refused`);
    const body = (await res.json()) as { error?: string };
    assert.ok(body.error, `?${query} carries an error message`);
  }
});

test('a request with no session is refused, as /api/fleet/jobs refuses it', async () => {
  const old = await jobsRoute.GET(get('/api/fleet/jobs?persona=hephaestus'));
  for (const query of ['', '?demo=1', '?general=hephaestus']) {
    const res = await finishedRoute.GET(get(`/api/fleet/finished-jobs${query}`));
    assert.equal(res.status, old.status, `${query || 'no query'}: same refusal as the old route`);
    assert.equal(res.status, 401);
  }
});

test('the route module does not import telemetry (no estate tick on this path)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'fleet', 'finished-jobs', 'route.ts'), 'utf8');
  const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line));
  assert.ok(imports.length > 0);
  assert.ok(!imports.some((line) => /telemetry/.test(line)), 'no import from telemetry');
  assert.ok(!/getEstate\s*\(/.test(source.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), 'no getEstate call');
});
