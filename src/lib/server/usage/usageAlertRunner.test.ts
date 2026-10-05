import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: HOME is set before the module under test is imported.
const HOME = tempDir('usage-alert-runner-');
const BIN_DIR = tempDir('usage-alert-bin-');
process.env.HOME = HOME;

const LOG = path.join(BIN_DIR, 'pushes.log');
const PUSH = path.join(BIN_DIR, 'push.sh');
const FAIL_FLAG = path.join(BIN_DIR, 'fail');
fs.writeFileSync(
  PUSH,
  `#!/bin/sh\nprintf '%s\\n' "$*" >> "${LOG}"\n[ -e "${FAIL_FLAG}" ] && exit 1\nexit 0\n`,
  { mode: 0o755 },
);
process.env.SAM_PUSH_BIN = PUSH;

type Runner = typeof import('./usageAlertRunner.js');
let runner: Runner;

const NOW = Date.parse('2026-10-05T12:00:00Z');
const H = 3600_000;
const secs = (ms: number) => Math.floor(ms / 1000);
const QUOTA = path.join(HOME, '.sam', 'quota');

let n = 0;
/** Appends one fixture row; `n` makes endedAt unique and newest so each edit is read. */
function writeRow(over: Record<string, unknown>): void {
  fs.mkdirSync(QUOTA, { recursive: true });
  n += 1;
  const row = {
    endedAt: new Date(NOW - 60_000 + n * 1000).toISOString(),
    seat: 'main',
    fiveHour: null,
    sevenDay: null,
    ...over,
  };
  fs.appendFileSync(path.join(QUOTA, 'runs.jsonl'), JSON.stringify(row) + '\n');
}

function reset(): void {
  fs.rmSync(QUOTA, { recursive: true, force: true });
  fs.rmSync(LOG, { force: true });
  fs.rmSync(FAIL_FLAG, { force: true });
}

const pushes = (): string[] =>
  fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];

test.before(async () => {
  runner = await import('./usageAlertRunner.js');
});

for (const [key, resetKey, label] of [
  ['fiveHour', 'fiveHourResetsAt', '5-hour'],
  ['sevenDay', 'sevenDayResetsAt', 'weekly'],
] as const) {
  test(`${label}: 0.79 sends nothing, 0.80 sends one push naming seat, 80% and reset`, async () => {
    reset();
    const resetAt = secs(NOW + 2 * H);
    writeRow({ [key]: 0.79, [resetKey]: resetAt });
    assert.deepEqual(await runner.runUsageAlerts(NOW), []);
    assert.equal(pushes().length, 0);

    writeRow({ [key]: 0.8, [resetKey]: resetAt });
    const sent = await runner.runUsageAlerts(NOW);
    assert.equal(sent.length, 1);
    const lines = pushes();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /main/);
    assert.match(lines[0], /80%/);
    assert.match(lines[0], /resets/);
    assert.match(lines[0], /--url \//);
    assert.match(lines[0], new RegExp(label));
  });

  test(`${label}: one ping per window, a new reset epoch pings again`, async () => {
    reset();
    const first = secs(NOW + 2 * H);
    writeRow({ [key]: 0.81, [resetKey]: first });
    await runner.runUsageAlerts(NOW);
    writeRow({ [key]: 0.9, [resetKey]: first });
    await runner.runUsageAlerts(NOW);
    writeRow({ [key]: 0.95, [resetKey]: first });
    await runner.runUsageAlerts(NOW);
    assert.equal(pushes().length, 1);

    const later = NOW + 30 * H;
    writeRow({ [key]: 0.85, [resetKey]: secs(later + 5 * H) });
    await runner.runUsageAlerts(later);
    assert.equal(pushes().length, 2);
  });
}

test('a failing push leaves the state unmarked, so the next call retries', async () => {
  reset();
  writeRow({ fiveHour: 0.9, fiveHourResetsAt: secs(NOW + 2 * H) });
  fs.writeFileSync(FAIL_FLAG, '');
  assert.deepEqual(await runner.runUsageAlerts(NOW), []);
  assert.equal(fs.existsSync(path.join(QUOTA, 'alerts.json')), false);
  fs.rmSync(FAIL_FLAG);
  assert.equal((await runner.runUsageAlerts(NOW)).length, 1);
  assert.equal(pushes().length, 2);
  assert.equal((await runner.runUsageAlerts(NOW)).length, 0);
});

test('a corrupt alerts.json does not throw', async () => {
  reset();
  writeRow({ fiveHour: 0.9, fiveHourResetsAt: secs(NOW + 2 * H) });
  fs.writeFileSync(path.join(QUOTA, 'alerts.json'), '{not json');
  const sent = await runner.runUsageAlerts(NOW);
  assert.equal(sent.length, 1);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(QUOTA, 'alerts.json'), 'utf8')));
});

test('two concurrent calls send one push', async () => {
  reset();
  writeRow({ fiveHour: 0.9, fiveHourResetsAt: secs(NOW + 2 * H) });
  const [a, b] = await Promise.all([runner.runUsageAlerts(NOW), runner.runUsageAlerts(NOW)]);
  assert.equal(a.length + b.length, 1);
  assert.equal(pushes().length, 1);
});
