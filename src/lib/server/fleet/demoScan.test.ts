/**
 * SAM — Demo-mode leak scan test (T21, Must 19; checks 13, 23, 30).
 *
 * First proves `scanForLeaks` itself is not a no-op (a fixture vault's fake
 * client name and a home-folder path both score a hit, a clean string
 * doesn't), then drives the four real routes the Dashboard polls in demo
 * mode (`/api/fleet/floor`, `/api/fleet/schedule`, `/api/fleet/spend`,
 * `/api/fleet/jobs` — found by reading `FloorCanvas`/`KpiTiles`/
 * `SpendByHourModule`/`JobDetailModule`/`GeneralDetailPanel`, T20b) end to
 * end: once against a live job store seeded with a leak (the "proves it
 * can fail" control — live mode must score a hit), then with `demo=1` on
 * every call, where it must score zero.
 *
 * No real client or person's name is used anywhere here — "Example Co" and
 * the fixture home path below are both invented.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

type FloorRoute = typeof import('../../../app/api/fleet/floor/route.js');
type ScheduleRoute = typeof import('../../../app/api/fleet/schedule/route.js');
type SpendRoute = typeof import('../../../app/api/fleet/spend/route.js');
type JobsRoute = typeof import('../../../app/api/fleet/jobs/route.js');
type AuthModule = typeof import('../auth/session.js');
type DemoScanModule = typeof import('./demoScan.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscan-'));
const tmpHome = path.join(tmp, 'home');
const vaultDir = path.join(tmp, 'vault');
fs.mkdirSync(tmpHome, { recursive: true });
fs.mkdirSync(path.join(vaultDir, '02 - Atwood Systems', '10_Clients', 'Example Co'), { recursive: true });

process.env.HOME = tmpHome;
process.env.SAM_VAULT_DIR = vaultDir;

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');
const AGENTS_DIR = path.join(tmpHome, '.claude', 'agents');

const GENERALS = ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'] as const;

const LEAK_HOME_PATH = '/home/colin-fixture/clients/example-co/notes.md';
const LEAK_COMMAND = `fleet:hephaestus (sonnet) — Build a prototype site for Example Co, brief at ${LEAK_HOME_PATH}`;

let floorRoute: FloorRoute;
let scheduleRoute: ScheduleRoute;
let spendRoute: SpendRoute;
let jobsRoute: JobsRoute;
let demoScan: DemoScanModule;
let sessionCookie = '';

before(async () => {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  for (const name of GENERALS) {
    fs.writeFileSync(
      path.join(AGENTS_DIR, `${name}.md`),
      `---\nname: ${name}\ndescription: Fixture\nmodel: sonnet\ntools: Read\n---\nFixture.\n`,
    );
  }

  // One live job carrying a real-shaped leak (a fake client name + a
  // home-folder path), so the live-mode control run has something to catch.
  const liveDir = path.join(JOBS_ROOT, 'job-live-leak');
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(
    path.join(liveDir, 'meta.json'),
    JSON.stringify(
      {
        id: 'job-live-leak',
        command: LEAK_COMMAND,
        status: 'exited',
        exitCode: 0,
        createdAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const auth: AuthModule = await import('../auth/session.js');
  const cookies = await auth.createSessionCookies({ sub: 'test-credential', device: 'pc', iat: 0 });
  const sessionOnly = cookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.ok(sessionOnly);
  sessionCookie = sessionOnly.split(';')[0];

  floorRoute = await import('../../../app/api/fleet/floor/route.js');
  scheduleRoute = await import('../../../app/api/fleet/schedule/route.js');
  spendRoute = await import('../../../app/api/fleet/spend/route.js');
  jobsRoute = await import('../../../app/api/fleet/jobs/route.js');
  demoScan = await import('./demoScan.js');
});

function get(urlPath: string): Request {
  return new Request(`http://localhost${urlPath}`, { headers: { cookie: sessionCookie } });
}

/** The combined JSON text of every route the Dashboard polls, live or demo. */
async function dashboardPollText(demo: boolean): Promise<string> {
  const q = demo ? '?demo=1' : '';
  const jobsQ = demo ? '&demo=1' : '';

  const bodies = await Promise.all([
    floorRoute.GET(get(`/api/fleet/floor${q}`)).then((r) => r.text()),
    scheduleRoute.GET(get(`/api/fleet/schedule${q}`)).then((r) => r.text()),
    spendRoute.GET(get(`/api/fleet/spend${q}`)).then((r) => r.text()),
    ...GENERALS.map((g) =>
      jobsRoute.GET(get(`/api/fleet/jobs?persona=${g}${jobsQ}`)).then((r) => r.text()),
    ),
  ]);
  return bodies.join('\n');
}

test('scanForLeaks is not a no-op: a fixture client name and a home path both score a hit, a clean string does not', () => {
  assert.ok(demoScan.scanForLeaks('Ask Example Co about the renewal.').length > 0);
  assert.ok(demoScan.scanForLeaks(`See ${LEAK_HOME_PATH} for the brief.`).length > 0);
  assert.equal(demoScan.scanForLeaks('Nothing sensitive in this sentence.').length, 0);
});

test('the live-mode control run scores at least one hit (proves the scan can fail)', async () => {
  const liveText = await dashboardPollText(false);
  const hits = demoScan.scanForLeaks(liveText);
  assert.ok(hits.length > 0, 'the live job\'s leaked client name/path must be caught');
});

test('demo mode (every route the Dashboard polls, demo=1) scores zero hits', async () => {
  const demoText = await dashboardPollText(true);
  assert.ok(!demoText.includes('Example Co'), 'sanity: the live fixture text must not appear at all in demo mode');
  const hits = demoScan.scanForLeaks(demoText);
  assert.deepEqual(hits, []);
});
