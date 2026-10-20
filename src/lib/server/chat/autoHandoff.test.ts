/**
 * SAM — T10 (audit B-01/B-03): a Max or Max 2 chat at 400k context hands off
 * by itself, at the start of the next turn.
 *
 * Spec must-do 10, check 11. Runs real turns through the real JobManager
 * (`systemd-run --user --scope`) against the fake CLI (`fakeClaude.ts`),
 * which writes the memo itself when its prompt holds a
 * `Write the memo to: <path>` line. The vault, the uploads dir and HOME are
 * temp dirs set BEFORE the modules under test are imported, as in
 * `handoff.test.ts`. Pings go to a temp stub. If `systemd-run --user` is
 * unavailable this file fails loudly; it never skips.
 *
 * The stored context size is set straight on the chat record
 * (`setContextTokens`, T9's setter): the fake CLI's own usage numbers are
 * small, and what is under test here is the turn-start check, not T9's hook.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';
import { settleBeforeRemoving, tempDir } from '@/lib/server/testing/tempDir';

type StartTurnModule = typeof import('./startTurn.js');
type HandoffModule = typeof import('./handoff.js');
type ChatStoreModule = typeof import('./chatStore.js');
type SessionLockModule = typeof import('./sessionLock.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

const tmp = tempDir('auto-handoff-');
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const max2Dir = path.join(tmp, 'claude-max2');
const vaultDir = path.join(tmp, 'vault');
const uploadsDir = path.join(tmp, 'uploads');
const logPath = path.join(tmp, 'fake-claude.log');
const pushSubs = path.join(tmp, 'push-subs.json');
const pushLog = path.join(tmp, 'push-log.jsonl');
const pushStubLog = path.join(tmp, 'push-stub.jsonl');
const pushStub = path.join(tmp, 'bin', 'push-stub.cjs');

let st: StartTurnModule;
let ho: HandoffModule;
let store: ChatStoreModule;
let lock: SessionLockModule;
let manager: ManagerModule;

/* Exit tracking keyed by job id and by chat id (a handoff child's job id is
   not known to the test until it has started). */
const exits = new Map<string, TurnExitEvent>();
const waiters = new Map<string, (e: TurnExitEvent) => void>();

function waitExit(key: string, timeoutMs = 20_000): Promise<TurnExitEvent> {
  const done = exits.get(key);
  if (done) return Promise.resolve(done);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`turn ${key} did not exit`)), timeoutMs);
    waiters.set(key, (e) => {
      clearTimeout(timer);
      resolve(e);
    });
  });
}

interface LogEntry {
  argv: string[];
  CLAUDE_CONFIG_DIR: string | null;
  SAM_CHAT_ID: string | null;
  stdinPrompt?: string;
}

/** Turn spawns in one chat (background title calls left out). */
function logFor(chatId: string): LogEntry[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry)
    .filter((e) => !e.argv.includes('--no-session-persistence'))
    .filter((e) => e.SAM_CHAT_ID === chatId);
}

function promptOf(entry: LogEntry): string {
  return entry.stdinPrompt ?? entry.argv[entry.argv.indexOf('-p') + 1] ?? '';
}

/** A finished Max/Max 2 chat whose stored context is `tokens`. */
async function chatAt(tokens: number, tier: 'max' | 'max2' = 'max', first = 'first message'): Promise<string> {
  const r = await st.startTurn({ message: first, tier, device: 'pc' });
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
  if (!r.ok) throw new Error('unreachable');
  await waitExit(r.jobId);
  exits.delete(r.chatId);
  store.setContextTokens(r.chatId, tokens);
  return r.chatId;
}

/** An uploaded file, as POST /api/uploads would leave it. */
function upload(name: string): { path: string; name: string } {
  const dir = path.join(uploadsDir, '2026-10-20');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${name}`);
  fs.writeFileSync(file, 'plan v3\n');
  return { path: file, name };
}

before(async () => {
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; autoHandoff.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  for (const dir of [home, agentDir, max2Dir, vaultDir, uploadsDir, path.dirname(pushStub)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(pushSubs, '[]');
  fs.writeFileSync(
    pushStub,
    `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(pushStubLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
    { mode: 0o755 },
  );

  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_MAX2_CONFIG_DIR = max2Dir;
  process.env.SAM_VAULT_DIR = vaultDir;
  process.env.SAM_UPLOADS_DIR = uploadsDir;
  process.env.SAM_PUSH_BIN = pushStub;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_PUSH_LOG = pushLog;
  process.env.SAM_REPLY_PING_MIN_MS = '0';
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.FAKE_CLAUDE_DELAY_MS = '600';
  delete process.env.FAKE_CLAUDE_REPLY;
  delete process.env.FAKE_SKIP_MEMO;
  process.env.FAKE_TITLE_FAIL = '1';
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';

  manager = await import('../jobs/manager.js');
  store = await import('./chatStore.js');
  lock = await import('./sessionLock.js');
  st = await import('./startTurn.js');
  ho = await import('./handoff.js');

  // After handoff.ts's own hook, so a memo turn's exit seen here means the
  // new chat has already been started (or the error recorded).
  st.onTurnExit.push((e) => {
    for (const key of [e.jobId, e.chatId]) {
      if (!exits.has(key)) exits.set(key, e);
      waiters.get(key)?.(e);
    }
  });
});

settleBeforeRemoving(1_500);
after(() => {
  manager?.getJobManager().stopSweep();
});

test('check 11: a Max chat at 410k hands off at turn start and carries the message (and file) into the new chat', async () => {
  const oldId = await chatAt(410_000, 'max', 'plan the auto handoff');
  const file = upload('notes.txt');

  const r = await st.startTurn({
    message: 'next thing',
    attachments: [file],
    tier: 'max',
    chatId: oldId,
    device: 'phone',
    autoHandoff: true,
  });
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
  if (!r.ok) return;
  assert.equal(r.autoHandoff, true, 'a memo turn, not a normal turn');
  if (!r.autoHandoff) return;
  assert.equal(r.chatId, oldId);
  assert.equal(r.attachmentCount, 1);

  // The pending handoff holds what Colin sent, attachments resolved.
  assert.equal(ho.isHandoffPending(oldId), true);
  const carried = ho.pendingCarried(oldId);
  assert.equal(carried?.message, 'next thing');
  assert.deepEqual(carried?.attachments, [file]);

  const memoExit = await waitExit(r.memoJobId);
  assert.equal(memoExit.internal, true);
  assert.equal(memoExit.chatId, oldId);
  assert.equal(ho.isHandoffPending(oldId), false);

  // The old chat ran its first turn and the memo turn, and never saw Colin's
  // message as a turn of its own.
  const oldTurns = logFor(oldId);
  assert.equal(oldTurns.length, 2);
  assert.match(promptOf(oldTurns[1]), /^Write the memo to: /m);
  assert.ok(!oldTurns.some((t) => promptOf(t).includes('next thing')));

  // The new chat's first prompt is the memo pointer plus Colin's message and file.
  const old = store.getChat(oldId);
  assert.ok(old?.handedOffTo, 'old chat has handedOffTo');
  assert.equal(old.handoffError, undefined);
  const newId = old.handedOffTo;
  await waitExit(newId);
  const [childTurn] = logFor(newId);
  assert.ok(childTurn, 'the new chat ran a turn');
  const childPrompt = promptOf(childTurn);
  assert.match(childPrompt, /^Continue from the handoff memo at .+ handoff\.md\. Read it first\./);
  assert.ok(
    childPrompt.includes("Colin's message, sent just before the handoff: next thing"),
    `child prompt carries the message: ${childPrompt}`,
  );
  assert.ok(childPrompt.includes(`- ${file.path}  (notes.txt)`), 'child prompt carries the attachment');
  const child = store.getChat(newId);
  assert.equal(child?.tier, 'max', 'the new chat runs on the chat\'s own tier');
  assert.equal(child?.handedOffFrom, oldId);
});

test('check 11: a Max 2 chat at 410k hands off onto Max 2', async () => {
  const oldId = await chatAt(410_000, 'max2', 'a max2 chat');
  const r = await st.startTurn({ message: 'carry on', tier: 'max2', chatId: oldId, device: 'pc', autoHandoff: true });
  assert.equal(r.ok && r.autoHandoff, true);
  if (!r.ok || !r.autoHandoff) return;
  await waitExit(r.memoJobId);
  const newId = store.getChat(oldId)?.handedOffTo;
  assert.ok(newId);
  await waitExit(newId);
  assert.equal(store.getChat(newId)?.tier, 'max2');
  const [childTurn] = logFor(newId);
  assert.equal(childTurn.CLAUDE_CONFIG_DIR, max2Dir);
  assert.ok(promptOf(childTurn).includes("Colin's message, sent just before the handoff: carry on"));
});

test('check 11: a chat at 390k runs a normal turn', async () => {
  const id = await chatAt(390_000);
  const r = await st.startTurn({ message: 'normal thing', tier: 'max', chatId: id, device: 'pc', autoHandoff: true });
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
  if (!r.ok) return;
  assert.equal(r.autoHandoff, undefined);
  assert.equal(ho.isHandoffPending(id), false);
  await waitExit(r.jobId);
  const turns = logFor(id);
  assert.equal(turns.length, 2);
  assert.equal(promptOf(turns[1]), 'normal thing');
  assert.equal(store.getChat(id)?.handedOffTo, undefined);
});

test('an internal turn, and a caller that did not opt in (the dashboard widget), never trigger it', async () => {
  const id = await chatAt(420_000);

  const internal = await st.startTurn({
    message: 'internal work',
    tier: 'max',
    chatId: id,
    device: 'pc',
    internal: true,
    autoHandoff: true,
  });
  assert.equal(internal.ok, true);
  if (!internal.ok) return;
  assert.equal(internal.autoHandoff, undefined);
  assert.equal(ho.isHandoffPending(id), false);
  await waitExit(internal.jobId);

  const widget = await st.startTurn({ message: 'from the widget', tier: 'max', chatId: id, device: 'pc' });
  assert.equal(widget.ok, true);
  if (!widget.ok) return;
  assert.equal(widget.autoHandoff, undefined);
  await waitExit(widget.jobId);

  const prompts = logFor(id).map(promptOf);
  assert.deepEqual(prompts.slice(1), ['internal work', 'from the widget']);
  assert.equal(store.getChat(id)?.handedOffTo, undefined);
});

test('check 11: a running turn is never interrupted; the check is only at turn start', async () => {
  const id = await chatAt(100_000);
  const running = await st.startTurn({ message: 'long job', tier: 'max', chatId: id, device: 'pc', autoHandoff: true });
  assert.equal(running.ok, true);
  if (!running.ok) return;
  assert.equal(running.autoHandoff, undefined);
  // The context passes 400k while that turn runs (as T9's hook would record
  // for a turn on another path); a send now must not start a handoff.
  store.setContextTokens(id, 450_000);
  assert.equal(lock.isSessionLocked(id), true);

  const second = await st.startTurn({ message: 'meanwhile', tier: 'max', chatId: id, device: 'phone', autoHandoff: true });
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.status, 409);
  assert.equal(ho.isHandoffPending(id), false);

  const exit = await waitExit(running.jobId);
  assert.equal(exit.exitCode, 0, 'the running turn finished on its own');
  const turns = logFor(id);
  assert.equal(turns.length, 2, 'no memo turn was spawned');
  assert.equal(promptOf(turns[1]), 'long job');
  assert.equal(store.getChat(id)?.handedOffTo, undefined);
});

test('a chat already handed off runs a normal turn', async () => {
  const id = await chatAt(410_000);
  store.markHandedOff(id, '11111111-2222-3333-4444-555555555555');
  const r = await st.startTurn({ message: 'back on the old one', tier: 'max', chatId: id, device: 'pc', autoHandoff: true });
  assert.equal(r.ok && r.autoHandoff, undefined);
  if (r.ok) await waitExit(r.jobId);
  assert.equal(promptOf(logFor(id)[1]), 'back on the old one');
});

test('if the handoff cannot start, the message still runs as a normal turn on the old chat', async () => {
  const realHooks = st.setAutoHandoff({
    isPending: () => false,
    start: async () => ({ ok: false, status: 503, error: 'memo seat unavailable' }),
  });
  try {
    const id = await chatAt(410_000);
    const r = await st.startTurn({ message: 'please still answer', tier: 'max', chatId: id, device: 'pc', autoHandoff: true });
    assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
    if (!r.ok) return;
    assert.equal(r.autoHandoff, undefined);
    await waitExit(r.jobId);
    assert.equal(promptOf(logFor(id)[1]), 'please still answer');

    // And when starting it throws outright.
    st.setAutoHandoff({
      isPending: () => false,
      start: async () => {
        throw new Error('spawn failed');
      },
    });
    const id2 = await chatAt(410_000);
    const r2 = await st.startTurn({ message: 'answer this too', tier: 'max', chatId: id2, device: 'pc', autoHandoff: true });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.autoHandoff, undefined);
    await waitExit(r2.jobId);
    assert.equal(promptOf(logFor(id2)[1]), 'answer this too');
  } finally {
    st.setAutoHandoff(realHooks);
  }
  assert.ok(realHooks, 'handoff.ts registered its hooks on import');
});

test('a manual handoff still starts the child with the memo pointer alone', async () => {
  const oldId = await chatAt(410_000, 'max', 'a manual one');
  const r = await ho.startHandoff(oldId, 'max', 'pc');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(ho.pendingCarried(oldId), undefined);
  await waitExit(r.memoJobId);
  const newId = store.getChat(oldId)?.handedOffTo;
  assert.ok(newId);
  const fresh = store.getChat(newId);
  assert.match(fresh?.firstMessage ?? '', /^Continue from the handoff memo at .+\. Read it first\.$/);
  await waitExit(newId);
});

test('a carried message already at the length cap still fits in the new chat', async () => {
  const oldId = await chatAt(410_000, 'max', 'a long one');
  const long = 'x'.repeat(st.MAX_MESSAGE_CHARS);
  const r = await st.startTurn({ message: long, tier: 'max', chatId: oldId, device: 'pc', autoHandoff: true });
  assert.equal(r.ok && r.autoHandoff, true);
  if (!r.ok || !r.autoHandoff) return;
  await waitExit(r.memoJobId);
  const old = store.getChat(oldId);
  assert.equal(old?.handoffError, undefined);
  assert.ok(old?.handedOffTo);
  await waitExit(old.handedOffTo);
  assert.ok(promptOf(logFor(old.handedOffTo)[0]).endsWith(`just before the handoff: ${long}`));
});

test('an automatic handoff whose memo is not written sets handoffError and starts nothing', async () => {
  const oldId = await chatAt(410_000, 'max', 'a seat at its limit');
  const chatsBefore = store.listChats().length + store.listChats({ archived: true }).length;
  process.env.FAKE_SKIP_MEMO = '1';
  try {
    const r = await st.startTurn({ message: 'lost?', tier: 'max', chatId: oldId, device: 'pc', autoHandoff: true });
    assert.equal(r.ok && r.autoHandoff, true);
    if (!r.ok || !r.autoHandoff) return;
    await waitExit(r.memoJobId);
  } finally {
    delete process.env.FAKE_SKIP_MEMO;
  }
  const old = store.getChat(oldId);
  assert.match(old?.handoffError ?? '', /memo was not written/);
  assert.equal(old?.handedOffTo, undefined);
  assert.equal(ho.isHandoffPending(oldId), false);
  assert.equal(store.listChats().length + store.listChats({ archived: true }).length, chatsBefore);
});
