/**
 * SAM — turnPing.ts: a clean reply pings only when the turn ran past
 * SAM_REPLY_PING_MIN_MS (default 2 minutes); a failed turn always pings.
 * Uses a stub push binary and synthetic exit events, so it needs no systemd.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { TurnExitEvent } from './startTurn';

const scratch = path.join(os.homedir(), '.cache', 'fewer-pings');
fs.mkdirSync(scratch, { recursive: true });
const tmp = fs.mkdtempSync(path.join(scratch, 'tp-'));
const hits = path.join(tmp, 'hits');
let pingOffScreenChat: (e: TurnExitEvent) => Promise<void>;

function ev(ms: number, exitCode: number | null, id: string): TurnExitEvent {
  const start = Date.parse('2026-10-08T10:00:00Z');
  return {
    chatId: id,
    jobId: `nojob-${id}`,
    exitCode,
    tier: 'max',
    internal: false,
    record: { startedAt: new Date(start).toISOString(), endedAt: new Date(start + ms).toISOString() },
    chat: null,
  } as unknown as TurnExitEvent;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = () => (fs.existsSync(hits) ? fs.readFileSync(hits, 'utf8').split('\n').filter(Boolean).length : 0);

before(async () => {
  const stub = path.join(tmp, 'stub.sh');
  fs.writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${hits}"\n`, { mode: 0o755 });
  process.env.SAM_PUSH_BIN = stub;
  delete process.env.SAM_REPLY_PING_MIN_MS;
  ({ pingOffScreenChat } = await import('./turnPing.js'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a clean 30 s turn sends no reply ping', async () => {
  await pingOffScreenChat(ev(30_000, 0, 'c-short'));
  await sleep(400);
  assert.equal(count(), 0);
});

test('a clean 3 minute turn pings once', async () => {
  await pingOffScreenChat(ev(180_000, 0, 'c-long'));
  await sleep(400);
  assert.equal(count(), 1);
});

test('a failed 5 s turn still pings', async () => {
  await pingOffScreenChat(ev(5_000, 1, 'c-fail'));
  await sleep(400);
  assert.equal(count(), 2);
});

test('SAM_REPLY_PING_MIN_MS overrides the threshold', async () => {
  process.env.SAM_REPLY_PING_MIN_MS = '1000';
  await pingOffScreenChat(ev(5_000, 0, 'c-env'));
  await sleep(400);
  assert.equal(count(), 3);
  delete process.env.SAM_REPLY_PING_MIN_MS;
});
