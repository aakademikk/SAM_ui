import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: HOME is set before the module under test is imported.
const HOME = tempDir('usage-sweep-');
const BIN_DIR = tempDir('usage-sweep-bin-');
process.env.HOME = HOME;

const LOG = path.join(BIN_DIR, 'pushes.log');
const PUSH = path.join(BIN_DIR, 'push.sh');
fs.writeFileSync(PUSH, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${LOG}"\nexit 0\n`, { mode: 0o755 });
process.env.SAM_PUSH_BIN = PUSH;

type Sweep = typeof import('./usageSweep.js');
let sweep: Sweep;

const QUOTA = path.join(HOME, '.sam', 'quota');
const INTERVAL = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pushes = (): string[] =>
  fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];

/** A row appended by hand, as a fleet harvest would: no chat turn involved. */
function appendFleetRow(): void {
  fs.mkdirSync(QUOTA, { recursive: true });
  const row = {
    endedAt: new Date().toISOString(),
    seat: 'main',
    fiveHour: 0.81,
    fiveHourResetsAt: Math.floor(Date.now() / 1000) + 2 * 3600,
    sevenDay: null,
  };
  fs.appendFileSync(path.join(QUOTA, 'runs.jsonl'), JSON.stringify(row) + '\n');
}

test.before(async () => {
  sweep = await import('./usageSweep.js');
});

test('a hand-written 0.81 row pings once within two intervals; later sweeps and a second start add nothing; no network, only the push binary spawned', async () => {
  const spawned: string[] = [];
  const otherProcess: string[] = [];
  let fetched = 0;
  const cp = childProcess as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const orig = cp[name] as (...a: unknown[]) => unknown;
    saved[name] = orig;
    cp[name] = (...a: unknown[]) => {
      if (name === 'spawn') spawned.push(String(a[0]));
      else otherProcess.push(name);
      return orig(...a);
    };
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetched += 1;
    return Promise.reject(new Error('no network in the sweep'));
  }) as typeof fetch;
  const stop = sweep.startUsageSweep(INTERVAL);
  try {
    appendFleetRow();
    await sleep(INTERVAL * 2 + 60);
    assert.equal(pushes().length, 1, 'exactly one push within two intervals');
    assert.match(pushes()[0], /main/);

    // (b) further sweeps in the same window send nothing more.
    await sleep(INTERVAL * 5);
    assert.equal(pushes().length, 1);

    // (c) starting again gives the same timer, so still one push.
    assert.equal(sweep.startUsageSweep(INTERVAL), stop);
    await sleep(INTERVAL * 3);
    assert.equal(pushes().length, 1);

    // (d) the push binary is the only process, and fetch is never called.
    assert.ok(spawned.length > 0);
    assert.deepEqual([...new Set(spawned)], [PUSH]);
    assert.deepEqual(otherProcess, []);
    assert.equal(fetched, 0);
  } finally {
    stop();
    globalThis.fetch = realFetch;
    for (const [name, orig] of Object.entries(saved)) cp[name] = orig;
  }
});

test('starting twice from fresh gives one timer and one push; stop allows a restart', async () => {
  fs.rmSync(QUOTA, { recursive: true, force: true });
  fs.rmSync(LOG, { force: true });
  const a = sweep.startUsageSweep(INTERVAL);
  const b = sweep.startUsageSweep(INTERVAL);
  try {
    assert.equal(a, b);
    appendFleetRow();
    await sleep(INTERVAL * 4);
    assert.equal(pushes().length, 1);
  } finally {
    a();
  }
  const c = sweep.startUsageSweep(INTERVAL);
  assert.notEqual(c, a);
  c();
});
