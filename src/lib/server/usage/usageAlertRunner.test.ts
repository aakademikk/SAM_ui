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
fs.writeFileSync(
  PUSH,
  `#!/bin/sh\nprintf '%s\\n' "$*" >> "${LOG}"\nexit 0\n`,
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
  test(`${label}: a reading over 80% stays logged and sends no push`, async () => {
    reset();
    const resetAt = secs(NOW + 2 * H);
    writeRow({ [key]: 0.79, [resetKey]: resetAt });
    writeRow({ [key]: 0.95, [resetKey]: resetAt });
    assert.deepEqual(await runner.runUsageAlerts(NOW), []);
    assert.equal(pushes().length, 0);
    assert.equal(fs.existsSync(path.join(QUOTA, 'alerts.json')), false);
    const rows = fs.readFileSync(path.join(QUOTA, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(rows.length, 2);
    assert.equal(JSON.parse(rows[1])[key], 0.95);
  });
}

test('two concurrent calls send nothing', async () => {
  reset();
  writeRow({ fiveHour: 0.9, fiveHourResetsAt: secs(NOW + 2 * H) });
  const [a, b] = await Promise.all([runner.runUsageAlerts(NOW), runner.runUsageAlerts(NOW)]);
  assert.equal(a.length + b.length, 0);
  assert.equal(pushes().length, 0);
});
