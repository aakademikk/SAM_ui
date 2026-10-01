/**
 * SAM — startTurn: every turn locked, tier fixed, chat id passed to the CLI.
 *
 * Checks 4 and 7 (server side). Runs real turns through the real JobManager
 * (`systemd-run --user --scope`) against the fake CLI from T1, never the real
 * `claude`. All state lives under a temp HOME set BEFORE the modules under
 * test are imported, because `JOBS_ROOT` (manager.ts) and `REGISTRY_FILE`
 * (samuiSessions.ts) are computed at module load. If `systemd-run --user` is
 * unavailable this file fails loudly — it never skips.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

type StartTurnModule = typeof import('./startTurn.js');
type ChatStoreModule = typeof import('./chatStore.js');
type SessionLockModule = typeof import('./sessionLock.js');
type TranscriptsModule = typeof import('./transcripts.js');
type SessionsModule = typeof import('./samuiSessions.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'start-turn-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const max2Dir = path.join(tmp, 'claude-max2');
const logPath = path.join(tmp, 'fake-claude.log');
const pushSubs = path.join(tmp, 'push-subs.json');

let st: StartTurnModule;
let store: ChatStoreModule;
let lock: SessionLockModule;
let transcripts: TranscriptsModule;
let sessions: SessionsModule;
let manager: ManagerModule;

/* Exit tracking: every finished turn lands here, whether or not a test is
   waiting on it yet (a turn can finish before its waiter registers). */
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

interface LogEntry {
  argv: string[];
  cwd: string;
  CLAUDE_CONFIG_DIR: string | null;
  SAM_CHAT_ID: string | null;
}

/** Turn spawns only. T7's exit hook fires a background Haiku title call after
 *  each turn through the same fake CLI; those are not turns, so they are left
 *  out of the "nothing spawned" / "one spawn" counts below. */
function readLog(): LogEntry[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry)
    .filter((e) => !e.argv.includes('--no-session-persistence'));
}

function logFor(chatId: string): LogEntry[] {
  return readLog().filter((e) => e.SAM_CHAT_ID === chatId);
}

function assertOk(
  r: Awaited<ReturnType<StartTurnModule['startTurn']>>,
): asserts r is Extract<typeof r, { ok: true }> {
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
}

function lastReply(chatId: string): string {
  const history = transcripts.readHistory(chatId);
  const last = history[history.length - 1];
  assert.ok(last && last.role === 'assistant', 'history ends with an assistant message');
  const text = last.blocks.find((b) => b.kind === 'text');
  return text && text.kind === 'text' ? text.text : '';
}

before(async () => {
  // Fail loudly, never skip: the whole point is the real spawn path.
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; startTurn.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(max2Dir, { recursive: true });
  fs.writeFileSync(pushSubs, '[]');

  process.env.HOME = home;
  // This shell (and Claude Code sessions generally) may export
  // CLAUDE_CONFIG_DIR pointing at a LIVE config home. tierEnv('max') does not
  // remove it, so an inherited value would send main-account fake turns'
  // transcripts into the real ~/.claude-max2. Unset it for this process and
  // every child it spawns.
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_MAX2_CONFIG_DIR = max2Dir;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.FAKE_CLAUDE_DELAY_MS = '1500';
  delete process.env.FAKE_CLAUDE_REPLY;
  // Never let an inherited value point the ledger reporter anywhere real (the
  // max tiers never report anyway).
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  manager = await import('../jobs/manager.js');
  sessions = await import('./samuiSessions.js');
  store = await import('./chatStore.js');
  lock = await import('./sessionLock.js');
  transcripts = await import('./transcripts.js');
  st = await import('./startTurn.js');

  // A throwing hook first: it must not stop the next one, or the lock release.
  let failedOnce = false;
  st.onTurnExit.push(() => {
    if (failedOnce) return;
    failedOnce = true;
    throw new Error('deliberately failing hook (expected once in this test log)');
  });
  st.onTurnExit.push((e) => {
    exits.set(e.jobId, e);
    waiters.get(e.jobId)?.(e);
  });
});

after(() => {
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let chatA = '';

test('check 4: two new chats started together both finish with their own replies', async () => {
  const [a, b] = await Promise.all([
    st.startTurn({ message: 'hello from chat A', tier: 'max', device: 'phone' }),
    st.startTurn({ message: 'hello from chat B', tier: 'max', device: 'pc' }),
  ]);
  assertOk(a);
  assertOk(b);
  assert.notEqual(a.chatId, b.chatId);
  assert.equal(a.created, true);
  chatA = a.chatId;

  // Both running at once, each locked, each recorded as running.
  assert.equal(lock.isSessionLocked(a.chatId), true);
  assert.equal(lock.isSessionLocked(b.chatId), true);
  assert.equal(store.getChat(a.chatId)?.runningJobId, a.jobId);
  assert.equal(store.getChat(b.chatId)?.runningJobId, b.jobId);
  assert.equal(sessions.isSamuiSession(a.chatId), true);

  const [ea, eb] = await Promise.all([waitExit(a.jobId), waitExit(b.jobId)]);
  assert.equal(ea.exitCode, 0);
  assert.equal(eb.exitCode, 0);
  assert.equal(ea.chatId, a.chatId);
  assert.equal(ea.internal, false);

  // Own replies, in own transcripts (main account: under HOME/.claude).
  assert.equal(lastReply(a.chatId), 'echo: hello from chat A');
  assert.equal(lastReply(b.chatId), 'echo: hello from chat B');
  assert.equal(transcripts.transcriptPath(a.chatId)?.account, 'main');
  assert.ok(transcripts.transcriptPath(a.chatId)?.path.startsWith(path.join(home, '.claude')));

  // Bookkeeping after exit.
  for (const id of [a.chatId, b.chatId]) {
    const rec = store.getChat(id);
    assert.ok(rec);
    assert.equal(rec.runningJobId, null);
    assert.equal(rec.turns, 1);
    assert.equal(rec.tier, 'max');
    assert.equal(rec.account, 'main');
    assert.equal(lock.isSessionLocked(id), false);
  }
  assert.equal(store.getChat(a.chatId)?.title, 'hello from chat A');

  // First turn: --session-id <id> and SAM_CHAT_ID = the chat id.
  const [entry] = logFor(a.chatId);
  assert.ok(entry, 'fake log has chat A');
  const i = entry.argv.indexOf('--session-id');
  assert.equal(entry.argv[i + 1], a.chatId);
  assert.equal(entry.argv.includes('--resume'), false);
  assert.equal(entry.CLAUDE_CONFIG_DIR, null);
});

test('a second turn on a running chat returns 409; the next turn resumes it', async () => {
  const second = await st.startTurn({
    message: 'second turn',
    tier: 'max',
    chatId: chatA,
    device: 'phone',
  });
  assertOk(second);
  assert.equal(second.chatId, chatA);
  assert.equal(second.created, false);

  const clash = await st.startTurn({
    message: 'third turn, too soon',
    tier: 'max',
    chatId: chatA,
    device: 'pc',
  });
  assert.equal(clash.ok, false);
  assert.equal(!clash.ok && clash.status, 409);
  assert.match(!clash.ok ? clash.error : '', /already in use on 'phone'/);

  await waitExit(second.jobId);
  assert.equal(lock.isSessionLocked(chatA), false);
  assert.equal(lastReply(chatA), 'echo: second turn');
  assert.equal(store.getChat(chatA)?.turns, 2);

  const entries = logFor(chatA);
  assert.equal(entries.length, 2, 'the refused turn never spawned');
  const r = entries[1].argv.indexOf('--resume');
  assert.ok(r >= 0, 'second turn resumes');
  assert.equal(entries[1].argv[r + 1], chatA);
  assert.equal(entries[1].SAM_CHAT_ID, chatA);
});

test('check 7: a turn on a different tier after the first message returns 409', async () => {
  const before = readLog().length;
  const r = await st.startTurn({ message: 'switch me', tier: 'max2', chatId: chatA, device: 'phone' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 409);
  assert.equal(!r.ok && r.error, 'This chat is on Max. Use Handoff to change tier.');
  assert.equal(lock.isSessionLocked(chatA), false, 'a refused turn takes no lock');
  assert.equal(readLog().length, before, 'nothing spawned');
});

test('a Max 2 chat runs with CLAUDE_CONFIG_DIR set to the Max 2 dir', async () => {
  const r = await st.startTurn({ message: 'on the second seat', tier: 'max2', device: 'pc' });
  assertOk(r);
  await waitExit(r.jobId);

  const [entry] = logFor(r.chatId);
  assert.ok(entry);
  assert.equal(entry.CLAUDE_CONFIG_DIR, max2Dir);
  const rec = store.getChat(r.chatId);
  assert.equal(rec?.tier, 'max2');
  assert.equal(rec?.account, 'max2');
  assert.equal(transcripts.transcriptPath(r.chatId)?.account, 'max2');
  assert.equal(lastReply(r.chatId), 'echo: on the second seat');
});

test('unknown and deleted chat ids get 404 and never spawn', async () => {
  const before = readLog().length;
  const unknown = await st.startTurn({
    message: 'hi',
    tier: 'max',
    chatId: '11111111-2222-3333-4444-555555555555',
    device: 'pc',
  });
  assert.equal(!unknown.ok && unknown.status, 404);

  const notUuid = await st.startTurn({ message: 'hi', tier: 'max', chatId: '../etc', device: 'pc' });
  assert.equal(!notUuid.ok && notUuid.status, 404);

  // A deleted chat is not resurrected, even though its id is in the registry
  // and its transcript exists (the pre-upgrade adopt path must not fire).
  const r = await st.startTurn({ message: 'doomed', tier: 'max', device: 'pc' });
  assertOk(r);
  await waitExit(r.jobId);
  const spawned = readLog().length;
  store.deleteChat(r.chatId);
  const deleted = await st.startTurn({ message: 'back?', tier: 'max', chatId: r.chatId, device: 'pc' });
  assert.equal(!deleted.ok && deleted.status, 404);
  assert.equal(store.getChat(r.chatId), null);
  assert.equal(readLog().length, spawned);
  assert.equal(spawned, before + 1);
});

test('a pre-upgrade chat (registry id + transcript, no record) is adopted and resumed', async () => {
  // Build a transcript the way an old SAM_ui turn left it: run the fake
  // directly in the agent cwd, then register the id as SAM_ui-owned.
  const legacyId = 'aaaaaaaa-1111-2222-3333-444444444444';
  const made = spawnSync(
    process.env.SAM_CLAUDE_BIN as string,
    ['-p', 'an old conversation about the kitchen', '--session-id', legacyId],
    { cwd: agentDir, env: { ...process.env, FAKE_CLAUDE_DELAY_MS: '0', FAKE_CLAUDE_LOG: '' }, encoding: 'utf8' },
  );
  assert.equal(made.status, 0, made.stderr);
  sessions.registerSamuiSession(legacyId);
  assert.equal(store.getChat(legacyId), null);

  // The fake's transcript has no model names, so its tier is unknown: the
  // requested tier (fast) is ignored and it runs as max on account main.
  const r = await st.startTurn({ message: 'carry on', tier: 'fast', chatId: legacyId, device: 'phone' });
  assertOk(r);
  assert.equal(r.tier, 'max');
  await waitExit(r.jobId);

  const rec = store.getChat(legacyId);
  assert.ok(rec);
  assert.equal(rec.tier, 'unknown');
  assert.equal(rec.account, 'main');
  assert.equal(rec.title, 'an old conversation about the kitchen');
  const [entry] = logFor(legacyId);
  assert.ok(entry.argv.includes('--resume'));
  assert.equal(entry.CLAUDE_CONFIG_DIR, null);
  assert.equal(lastReply(legacyId), 'echo: carry on');
});
