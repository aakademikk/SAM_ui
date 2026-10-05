import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import test, { mock } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';
import type { ApiEnvelope } from '@/types/dashboard';
import type { UsagePayload } from '@/types/usage';

// House rule: HOME is set before the module under test is imported.
const HOME_A = tempDir('usage-runs-a-');
const HOME_B = tempDir('usage-runs-b-');
const HOME_EMPTY = tempDir('usage-runs-empty-');
process.env.HOME = HOME_A;

type Route = typeof import('../../../app/api/dashboard/usage/route.js');
let route: Route;

const H = 3600_000;
const secs = (ms: number) => Math.floor(ms / 1000);

function writeRuns(home: string, rows: unknown[], raw: string[] = []): void {
  const dir = path.join(home, '.sam', 'quota');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [...rows.map((r) => JSON.stringify(r)), ...raw];
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), lines.join('\n') + '\n');
}

async function poll(): Promise<UsagePayload> {
  const res = await route.GET();
  const body = (await res.json()) as ApiEnvelope<UsagePayload>;
  return body.data;
}

test.before(async () => {
  route = await import('../../../app/api/dashboard/usage/route.js');
});

test('the route returns both seats with the right pct and reset', async () => {
  process.env.HOME = HOME_A;
  const now = Date.now();
  writeRuns(
    HOME_A,
    [
      {
        endedAt: new Date(now - 5 * 60_000).toISOString(),
        seat: 'main',
        fiveHour: 0.42,
        sevenDay: 0.57,
        fiveHourResetsAt: secs(now + 2 * H),
        sevenDayResetsAt: secs(now + 48 * H),
        tokens: { big: 'x'.repeat(200) },
      },
      {
        endedAt: new Date(now - 60_000).toISOString(),
        seat: 'max2',
        fiveHour: 0.1,
        sevenDay: 0.9,
        fiveHourResetsAt: secs(now + 3 * H),
        sevenDayResetsAt: secs(now + 72 * H),
      },
    ],
    ['not json at all', '[1,2]'],
  );
  const data = await poll();
  assert.deepEqual(
    data.seats.map((s) => s.id),
    ['main', 'max2'],
  );
  const [main, max2] = data.seats;
  assert.equal(main.fiveHour?.pct, 42);
  assert.equal(main.fiveHour?.state, 'current');
  assert.equal(main.fiveHour?.resetsAt, new Date(secs(now + 2 * H) * 1000).toISOString());
  assert.equal(main.sevenDay?.pct, 57);
  assert.equal(max2.fiveHour?.pct, 10);
  assert.equal(max2.sevenDay?.pct, 90);
});

test('a missing file gives two seats with null windows', async () => {
  process.env.HOME = HOME_EMPTY;
  const data = await poll();
  assert.equal(data.seats.length, 2);
  for (const s of data.seats) {
    assert.equal(s.fiveHour, null);
    assert.equal(s.sevenDay, null);
  }
});

test('HOME override redirects the read, and a changed file is re-read', async () => {
  const now = Date.now();
  const rowFor = (five: number, ageMs = 60_000) => ({
    endedAt: new Date(now - ageMs).toISOString(),
    seat: 'main',
    fiveHour: five,
    sevenDay: 0.3,
    fiveHourResetsAt: secs(now + 2 * H),
    sevenDayResetsAt: secs(now + 48 * H),
  });
  writeRuns(HOME_A, [rowFor(0.2)]);
  writeRuns(HOME_B, [rowFor(0.7)]);
  process.env.HOME = HOME_A;
  assert.equal((await poll()).seats[0].fiveHour?.pct, 20);
  process.env.HOME = HOME_B;
  assert.equal((await poll()).seats[0].fiveHour?.pct, 70);
  // Same path, new size: the cache must notice.
  writeRuns(HOME_B, [rowFor(0.7, 120_000), rowFor(0.75, 30_000)]);
  assert.equal((await poll()).seats[0].fiveHour?.pct, 75);
});

test('check 3: 20 polls start no process, make no network call, and write no job', async () => {
  process.env.HOME = HOME_A;
  const now = Date.now();
  writeRuns(HOME_A, [
    {
      endedAt: new Date(now - 60_000).toISOString(),
      seat: 'main',
      fiveHour: 0.5,
      sevenDay: 0.5,
      fiveHourResetsAt: secs(now + 2 * H),
      sevenDayResetsAt: secs(now + 48 * H),
    },
  ]);
  await poll(); // warm: any one-off estate set-up happens before the spies go in

  const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  const spies = [
    mock.method(cp, 'spawn', () => assert.fail('spawn called')),
    mock.method(cp, 'exec', () => assert.fail('exec called')),
    mock.method(cp, 'execFile', () => assert.fail('execFile called')),
    mock.method(cp, 'fork', () => assert.fail('fork called')),
    mock.method(globalThis, 'fetch', () => assert.fail('fetch called')),
    mock.method(http, 'request', () => assert.fail('http.request called')),
    mock.method(https, 'request', () => assert.fail('https.request called')),
  ];
  try {
    for (let i = 0; i < 20; i++) {
      const data = await poll();
      assert.equal(data.seats[0].fiveHour?.pct, 50);
    }
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
  const jobs = path.join(HOME_A, '.sam', 'jobs');
  assert.ok(!fs.existsSync(jobs) || fs.readdirSync(jobs).length === 0);
});
