/**
 * SAM — turnPing.ts: ping when an off-screen chat finishes a turn.
 *
 * Spec must-do 7a, 15; check 5a. Runs real turns through the real JobManager
 * (`systemd-run --user --scope`) against the fake CLI from T1, the same
 * setup `startTurn.test.ts` uses — the ping needs a real job's stream-json
 * output to read the answer back out of (`readFrames` + a fresh
 * `AgentStreamParser`), not a hand-written transcript.
 *
 * BOX-ONLY: this needs both the real `sam-push` and `systemd-run --user`, so
 * on a GitHub-hosted runner it reports SKIPPED with its reason rather than
 * failing on a missing binary (see boxOnly.ts). On the box it runs in full,
 * and there a broken `systemd-run --user` still fails the file loudly rather
 * than skipping — that is a real fault on the machine that has it.
 *
 * `sam-push` itself is exercised the same way T9's `samPush.test.ts` does:
 * the STAGED copy (`send.next.mjs`) if it exists, else the LIVE symlink,
 * with `SAM_PUSH_SUBS` pointing at a temp file holding `[]` and
 * `SAM_PUSH_LOG` at a temp path — so this test never reads Colin's real
 * subscriber list and never writes to his real push log. With no
 * `push-vapid.json` under the temp `HOME`, every call exits 2 (no VAPID
 * keys) well after the ping is logged, exactly as T9 established — nothing
 * is ever actually sent.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';
import { boxOnlySkip } from '@/lib/server/testing/boxOnly';

type StartTurnModule = typeof import('./startTurn.js');
type SessionLockModule = typeof import('./sessionLock.js');
type FocusModule = typeof import('./focus.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

const STAGED_PUSH = '/home/col/.sam/sam-push/send.next.mjs';
const LIVE_PUSH = '/home/col/.local/bin/sam-push';
const PUSH_BIN = fs.existsSync(STAGED_PUSH) ? STAGED_PUSH : LIVE_PUSH;

/* false on the box; a reason string on a hosted runner. Every test below
 * needs the real sam-push, so the whole file skips together — including
 * `before`, which would otherwise throw on `systemd-run --user` before any
 * test could report itself skipped. See boxOnly.ts. */
const SKIP = boxOnlySkip('the real sam-push (staged send.next.mjs, else the live symlink)', [PUSH_BIN]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-ping-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const pushSubsFile = path.join(tmp, 'push-subs.json');
const pushLogFile = path.join(tmp, 'push-log.jsonl');

let st: StartTurnModule;
let lock: SessionLockModule;
let focus: FocusModule;
let manager: ManagerModule;

/* Exit tracking, the same pattern startTurn.test.ts uses: every finished
   turn lands here, whether or not a test is waiting on it yet. */
const exits = new Map<string, TurnExitEvent>();
const waiters = new Map<string, (e: TurnExitEvent) => void>();

function waitExit(jobId: string, timeoutMs = 20_000): Promise<TurnExitEvent> {
  const done = exits.get(jobId);
  if (done) return Promise.resolve(done);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`turn ${jobId} did not exit`)), timeoutMs);
    waiters.set(jobId, (e) => {
      clearTimeout(timer);
      resolve(e);
    });
  });
}

function assertOk(
  r: Awaited<ReturnType<StartTurnModule['startTurn']>>,
): asserts r is Extract<typeof r, { ok: true }> {
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
}

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

function readPushLog(): LoggedPing[] {
  if (!fs.existsSync(pushLogFile)) return [];
  return fs
    .readFileSync(pushLogFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedPing);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls the push log until it holds at least `count` entries, or throws
 *  after `timeoutMs` — the ping is a detached, fire-and-forget spawn (see
 *  `turnPing.ts`), so the test cannot just await it. */
async function waitForPushLog(count: number, timeoutMs = 10_000): Promise<LoggedPing[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entries = readPushLog();
    if (entries.length >= count) return entries;
    if (Date.now() > deadline) {
      throw new Error(`push log never reached ${count} entries (has ${entries.length})`);
    }
    await sleep(100);
  }
}

before(async () => {
  // Hosted runner: no sam-push, so nothing here can run. Return before the
  // probe — otherwise this hook throws and the file fails instead of
  // reporting its two tests skipped.
  if (SKIP) return;

  // On the box, fail loudly rather than skip: the whole point is the real
  // spawn path, and a broken systemd-run --user is a genuine fault in the
  // machine that is supposed to have it.
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; turnPing.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(pushSubsFile, '[]');

  process.env.HOME = home;
  // This shell may export a live CLAUDE_CONFIG_DIR; unset it so a fake turn's
  // transcript never lands in a real config dir.
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_PUSH_BIN = PUSH_BIN;
  process.env.SAM_PUSH_SUBS = pushSubsFile;
  // These turns last under a second; the quiet-reply threshold has its own test.
  process.env.SAM_REPLY_PING_MIN_MS = '0';
  process.env.SAM_PUSH_LOG = pushLogFile;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  delete process.env.FAKE_CLAUDE_LOG;
  // Long enough that both turns are still running when the test calls
  // setFocus for chat A, short enough to keep the test fast.
  process.env.FAKE_CLAUDE_DELAY_MS = '800';
  delete process.env.FAKE_CLAUDE_REPLY;
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  manager = await import('../jobs/manager.js');
  lock = await import('./sessionLock.js');
  focus = await import('./focus.js');
  st = await import('./startTurn.js');

  st.onTurnExit.push((e) => {
    exits.set(e.jobId, e);
    waiters.get(e.jobId)?.(e);
  });
});

after(() => {
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('check 5a: the off-screen chat gets one ping; the on-screen chat gets none', { skip: SKIP }, async () => {
  const [a, b] = await Promise.all([
    st.startTurn({ message: 'hello from chat A', tier: 'max', device: 'pc' }),
    st.startTurn({ message: 'hello from chat B', tier: 'max', device: 'phone' }),
  ]);
  assertOk(a);
  assertOk(b);

  // Device "pc" reports chat A on screen while both turns are still running.
  focus.setFocus('pc', a.chatId);
  assert.equal(focus.isOnScreen(a.chatId), true);
  assert.equal(focus.isOnScreen(b.chatId), false);

  await Promise.all([waitExit(a.jobId), waitExit(b.jobId)]);
  assert.equal(lock.isSessionLocked(a.chatId), false);
  assert.equal(lock.isSessionLocked(b.chatId), false);

  const entries = await waitForPushLog(1);
  // Wait a bit longer to prove chat A's (on-screen) turn never adds a second
  // entry — the ping is a detached spawn, so absence of a second line after
  // a real wait is the only way to show it never fires.
  await sleep(1500);

  assert.equal(readPushLog().length, 1, 'exactly one ping logged for two finished turns');
  const entry = entries[0];
  assert.equal(entry.url, `/chat?c=${b.chatId}`);
  assert.equal(entry.chatId, b.chatId);
  assert.equal(entry.jobId, null);
  assert.equal(entry.title, 'SAM replied');
  assert.match(entry.body, /echo: hello from chat B/);
});

test('an internal turn never pings, even off screen', { skip: SKIP }, async () => {
  const before = readPushLog().length;
  const r = await st.startTurn({
    message: 'handoff memo turn',
    tier: 'max',
    device: 'pc',
    internal: true,
  });
  assertOk(r);
  assert.equal(focus.isOnScreen(r.chatId), false);

  await waitExit(r.jobId);
  await sleep(1500);

  assert.equal(readPushLog().length, before, 'an internal turn logs no ping');
});
