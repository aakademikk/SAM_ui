/**
 * usageCollect — the turn-exit hook harvests and alerts with no timer (spec
 * U9, U8, check 22).
 *
 * Box-only: it runs the real Python harvester. The script is resolved as the
 * staged `sam-quota-log.next.py` when present (it carries `fiveHourResetsAt`),
 * else the live one; the test names which in its output. HOME is a temp dir
 * and SAM_PUSH_BIN a recording script, so the real ~/.sam is never written and
 * no real push is sent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';
import { tempDir } from '@/lib/server/testing/tempDir';

// House rule: HOME is set before the module under test is imported.
const HOME = tempDir('usage-collect-');
const BIN_DIR = tempDir('usage-collect-bin-');
process.env.HOME = HOME;

function stagedOrLive(staged: string, live: string): string {
  return fs.existsSync(staged) ? staged : live;
}

const STAGED = '/home/col/bin/sam-quota-log.next.py';
const LIVE = '/home/col/bin/sam-quota-log.py';
const HARVESTER = stagedOrLive(STAGED, LIVE);
const SKIP = boxOnlySkip('the real sam-quota-log script', [HARVESTER]);

const PUSH = path.join(BIN_DIR, 'push.sh');
const LOG = path.join(BIN_DIR, 'pushes.log');
fs.writeFileSync(
  PUSH,
  // Epoch nanoseconds first, so the test can measure endedAt to push.
  `#!/bin/sh\nprintf '%s %s\\n' "$(date +%s%N)" "$*" >> "${LOG}"\nexit 0\n`,
  { mode: 0o755 },
);
process.env.SAM_PUSH_BIN = PUSH;
process.env.SAM_QUOTA_LOG_BIN = HARVESTER;

const SESSION = '11111111-2222-4333-8444-555555555555';

/** One framed event: 4-byte channel, 4-byte big-endian length, JSON body. */
function frame(event: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(event));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(1, 0);
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

const pushes = (): string[] =>
  fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];

/** A finished chat-turn job with a five-hour reading, ended `endedAt`. */
function fakeJob(id: string, utilization: number, resetsAt: number, endedAt: Date): void {
  const dir = path.join(HOME, '.sam', 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({
      id,
      command: 'sam-agent (Max) — hello',
      status: 'exited',
      endedAt: endedAt.toISOString(),
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'stdout.log'),
    Buffer.concat([
      frame({ type: 'system', session_id: SESSION }),
      frame({
        type: 'rate_limit_event',
        session_id: SESSION,
        rate_limit_info: {
          status: 'allowed',
          unifiedWindows: { five_hour: { utilization, resetsAt } },
        },
      }),
      frame({ type: 'result', session_id: SESSION, num_turns: 1, modelUsage: {} }),
    ]),
  );
}

type Collect = typeof import('./usageCollect.js');
type StartTurn = typeof import('../chat/startTurn.js');
let collect: Collect;

test.before(async () => {
  // The seat resolves to `main` from a transcript under ~/.claude/projects.
  const projects = path.join(HOME, '.claude', 'projects', 'x');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(projects, `${SESSION}.jsonl`), '{}\n');
  collect = await import('./usageCollect.js');
  console.log(`# harvester under test: ${HARVESTER} (${HARVESTER === STAGED ? 'staged .next' : 'live'})`);
});

test('a harvester that fails or a missing binary does not throw', { skip: SKIP }, async () => {
  const failing = path.join(BIN_DIR, 'fail.py');
  fs.writeFileSync(failing, 'import sys\nsys.exit(3)\n');
  try {
    process.env.SAM_QUOTA_LOG_BIN = failing;
    await assert.doesNotReject(collect.collectUsage());
    process.env.SAM_QUOTA_LOG_BIN = path.join(BIN_DIR, 'does-not-exist.py');
    await assert.doesNotReject(collect.collectUsage());
  } finally {
    process.env.SAM_QUOTA_LOG_BIN = HARVESTER;
  }
  assert.equal(pushes().length, 0);
});

test('a finished turn is harvested and sends no usage push (fewer pings, 2026-10-08)', { skip: SKIP }, async () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 2 * 3600;
  fakeJob('job_1', 0.81, resetsAt, new Date());

  await collect.collectUsage();
  assert.equal(pushes().length, 0, `expected no push, got: ${pushes().join(' | ')}`);

  // The reading is still logged: the harvester's row is what the dashboard shows.
  fakeJob('job_2', 0.82, resetsAt, new Date());
  await collect.collectUsage();
  assert.equal(pushes().length, 0);
});

test('the turn exit hooks include the collect hook, and it runs the harvester', { skip: SKIP }, async () => {
  const start: StartTurn = await import('../chat/startTurn.js');
  const marker = path.join(BIN_DIR, 'hook-ran');
  const probe = path.join(BIN_DIR, 'probe.py');
  fs.writeFileSync(probe, `open(${JSON.stringify(marker)}, 'w').close()\n`);
  process.env.SAM_QUOTA_LOG_BIN = probe;
  try {
    const hook = start.onTurnExit[start.onTurnExit.length - 1];
    assert.ok(hook, 'no exit hooks registered');
    // The event is unused by the collect hook.
    await hook({} as Parameters<typeof hook>[0]);
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(fs.existsSync(marker), 'the last exit hook did not run the harvester');
  } finally {
    process.env.SAM_QUOTA_LOG_BIN = HARVESTER;
    await collect.collectUsage(); // let the hook's in-flight run settle
  }
});
