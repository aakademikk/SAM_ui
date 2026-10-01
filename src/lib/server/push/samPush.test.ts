/**
 * SAM — sam-push: every ping is logged and links to its chat or its own
 * Notifications entry (staged).
 *
 * Spec: must-do 15, 17, 19; checks 11 and 12 (link part). This exercises the
 * STAGED copy, `/home/col/.sam/sam-push/send.next.mjs` (a sibling of the
 * live `send.mjs`, so `web-push` resolves via that directory's
 * node_modules), falling back to the live `sam-push` symlink if the staged
 * copy is ever removed — so this test still holds once T21 installs it.
 * Either way the test never touches live state: `SAM_PUSH_SUBS` points at a
 * temp file holding `[]` and `SAM_PUSH_LOG` at a temp path, and `HOME` for
 * the child process is a fresh temp dir with no `.sam/push-vapid.json` in
 * it, so the default log/subs/VAPID paths baked into the script could never
 * resolve to Colin's real `~/.sam`.
 *
 * Because that temp HOME has no VAPID keys, every call here exits 2 (the
 * "no VAPID keys — run the key generator first" path in send.mjs, byte for
 * byte unchanged) — it never gets far enough to send a real push, or even
 * to read the (empty) subscriber list. What matters for this ticket is that
 * the ping is logged *before* that VAPID load, so the log line exists
 * regardless of whether delivery could proceed.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

const STAGED = '/home/col/.sam/sam-push/send.next.mjs';
const LIVE = '/home/col/.local/bin/sam-push';
const SCRIPT = fs.existsSync(STAGED) ? STAGED : LIVE;

/* A temp HOME with no ~/.sam/push-vapid.json: send.mjs's VAPID load always
 * fails under it, so every call below exits 2. That is exactly the exit
 * code send.mjs already uses for "no VAPID keys" — asserted below rather
 * than swallowed, so a future change to that path is caught. */
const NO_VAPID_EXIT_CODE = 2;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-push-'));
const home = path.join(tmp, 'home');
const subsFile = path.join(tmp, 'push-subs.json');
const logFile = path.join(tmp, 'push-log.jsonl');

interface LoggedPing {
  id: string;
  ts: number;
  title: string;
  body: string;
  url: string;
  tag: string;
  chatId: string | null;
  jobId: string | null;
}

before(() => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(subsFile, '[]');
});

function readLog(): LoggedPing[] {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedPing);
}

function runPush(args: string[], extraEnv: { SAM_CHAT_ID?: string } = {}) {
  const env = {
    ...process.env,
    HOME: home,
    SAM_PUSH_SUBS: subsFile,
    SAM_PUSH_LOG: logFile,
    SAM_CHAT_ID: extraEnv.SAM_CHAT_ID,
  };
  if (extraEnv.SAM_CHAT_ID === undefined) delete env.SAM_CHAT_ID;
  return spawnSync(SCRIPT, args, { env, encoding: 'utf8', timeout: 10_000 });
}

test('a ping with SAM_CHAT_ID and no --url logs a /chat?c=<uuid> link', () => {
  const linesBefore = readLog().length;
  const chatId = '11111111-2222-3333-4444-555555555555';
  const r = runPush(['--title', 'SAM replied', '--body', 'hello', '--tag', 'chat-' + chatId], {
    SAM_CHAT_ID: chatId,
  });
  assert.equal(r.status, NO_VAPID_EXIT_CODE, r.stderr);

  const lines = readLog();
  assert.equal(lines.length, linesBefore + 1, 'exactly one line logged for this call');
  const entry = lines[lines.length - 1];
  assert.equal(entry.url, '/chat?c=' + chatId);
  assert.equal(entry.chatId, chatId);
  assert.equal(entry.jobId, null);
  assert.equal(entry.title, 'SAM replied');
});

test('a ping with no chat and no --url logs a /notifications?n=<its own id> link', () => {
  const linesBefore = readLog().length;
  const r = runPush(['--title', 'Delegation check', '--body', 'fleet idle', '--tag', 'fleet']);
  assert.equal(r.status, NO_VAPID_EXIT_CODE, r.stderr);

  const lines = readLog();
  assert.equal(lines.length, linesBefore + 1, 'exactly one line logged for this call');
  const entry = lines[lines.length - 1];
  assert.equal(entry.chatId, null);
  assert.equal(entry.url, '/notifications?n=' + entry.id);
});

test('an explicit --url wins even when SAM_CHAT_ID is set', () => {
  const linesBefore = readLog().length;
  const chatId = '99999999-8888-7777-6666-555555555555';
  const r = runPush(['--title', 'Job done', '--body', 'see output', '--url', '/jobs/x'], {
    SAM_CHAT_ID: chatId,
  });
  assert.equal(r.status, NO_VAPID_EXIT_CODE, r.stderr);

  const lines = readLog();
  assert.equal(lines.length, linesBefore + 1, 'exactly one line logged for this call');
  const entry = lines[lines.length - 1];
  assert.equal(entry.url, '/jobs/x');
  // The chat is still recorded even though the explicit --url won the link.
  assert.equal(entry.chatId, chatId);
});

test('a --job id with no chat is recorded and still gets a Notifications link', () => {
  const linesBefore = readLog().length;
  const r = runPush(['--title', 'Job pinged', '--body', 'output ready', '--job', 'job-42']);
  assert.equal(r.status, NO_VAPID_EXIT_CODE, r.stderr);

  const lines = readLog();
  assert.equal(lines.length, linesBefore + 1, 'exactly one line logged for this call');
  const entry = lines[lines.length - 1];
  assert.equal(entry.chatId, null);
  assert.equal(entry.jobId, 'job-42');
  assert.equal(entry.url, '/notifications?n=' + entry.id);
});

test('a non-UUID SAM_CHAT_ID is ignored: no chat link', () => {
  const linesBefore = readLog().length;
  const r = runPush(['--title', 'Bad chat id', '--body', 'x'], { SAM_CHAT_ID: 'not-a-uuid' });
  assert.equal(r.status, NO_VAPID_EXIT_CODE, r.stderr);

  const lines = readLog();
  assert.equal(lines.length, linesBefore + 1, 'exactly one line logged for this call');
  const entry = lines[lines.length - 1];
  assert.equal(entry.chatId, null);
  assert.equal(entry.url, '/notifications?n=' + entry.id);
});

test('one line is logged per call: five calls so far logged exactly five lines', () => {
  // The preceding five tests each asserted their own call added exactly one
  // line; this checks the running total lines up with every call made in
  // this file, i.e. no call ever logs zero or more than one line.
  assert.equal(readLog().length, 5);
});
