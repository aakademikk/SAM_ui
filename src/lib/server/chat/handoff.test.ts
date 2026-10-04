/**
 * SAM — handoff.ts: hand a chat off to a new chat on a picked tier.
 *
 * Check 7b (server side). Runs real turns through the real JobManager
 * (`systemd-run --user --scope`) against the fake CLI from T1, which writes
 * the memo itself when its prompt holds a `Write the memo to: <path>` line
 * (and, with `FAKE_SKIP_MEMO=1`, does not — the missing-memo case). The vault
 * is a temp dir (`SAM_VAULT_DIR`), so nothing is ever written to the real
 * `06 - Handoffs/`. All other state lives under a temp HOME set BEFORE the
 * modules under test are imported (`JOBS_ROOT`, `REGISTRY_FILE` are computed
 * at module load). If `systemd-run --user` is unavailable this file fails
 * loudly — it never skips.
 *
 * Pings: `SAM_PUSH_BIN` points at a temp stub that only appends its argv to
 * a temp file (and `SAM_PUSH_SUBS` / `SAM_PUSH_LOG` are temp too), so no
 * turn here can reach Colin's phone — and the stub's log shows the memo turn
 * (internal) never pinged.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

type StartTurnModule = typeof import('./startTurn.js');
type HandoffModule = typeof import('./handoff.js');
type ChatStoreModule = typeof import('./chatStore.js');
type SessionLockModule = typeof import('./sessionLock.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const max2Dir = path.join(tmp, 'claude-max2');
const vaultDir = path.join(tmp, 'vault');
const handoffsDir = path.join(vaultDir, '06 - Handoffs');
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

/* Exit tracking, as in startTurn.test.ts, keyed by job id and by chat id
   (the new chat's job id is not known to the test until it has started). */
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
  /** Stream-json turns (Max/Max2): the prompt as read from stdin, logged in
   *  place of the now-absent argv prompt. */
  stdinPrompt?: string;
}

/** Turn spawns only (T7's background title calls are left out). */
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

/** Chat ids the push stub was called with (`--chat <id>`). */
function pingedChats(): string[] {
  if (!fs.existsSync(pushStubLog)) return [];
  return fs
    .readFileSync(pushStubLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const argv = JSON.parse(line) as string[];
      return argv[argv.indexOf('--chat') + 1];
    });
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function handoffFiles(): string[] {
  return fs.existsSync(handoffsDir) ? fs.readdirSync(handoffsDir).sort() : [];
}

/** A finished chat: one ordinary turn, run to exit. */
async function finishedChat(message: string): Promise<string> {
  const r = await st.startTurn({ message, tier: 'max', device: 'pc' });
  assert.equal(r.ok, true, r.ok ? '' : `startTurn failed: ${r.status} ${r.error}`);
  if (!r.ok) throw new Error('unreachable');
  await waitExit(r.jobId);
  return r.chatId;
}

before(async () => {
  // Fail loudly, never skip: the whole point is the real spawn path.
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; handoff.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(max2Dir, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(path.dirname(pushStub), { recursive: true });
  fs.writeFileSync(pushSubs, '[]');
  fs.writeFileSync(
    pushStub,
    `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(pushStubLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
    { mode: 0o755 },
  );

  process.env.HOME = home;
  // A live CLAUDE_CONFIG_DIR inherited from this shell would send fake
  // transcripts into a real config dir; see startTurn.test.ts.
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_MAX2_CONFIG_DIR = max2Dir;
  process.env.SAM_VAULT_DIR = vaultDir;
  process.env.SAM_PUSH_BIN = pushStub;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_PUSH_LOG = pushLog;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.FAKE_CLAUDE_DELAY_MS = '600';
  delete process.env.FAKE_CLAUDE_REPLY;
  delete process.env.FAKE_SKIP_MEMO;
  // Keep each chat's fallback title (its first message), so the memo's file
  // name is known; T7's background Haiku call would otherwise rename it.
  process.env.FAKE_TITLE_FAIL = '1';
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  manager = await import('../jobs/manager.js');
  store = await import('./chatStore.js');
  lock = await import('./sessionLock.js');
  st = await import('./startTurn.js');
  ho = await import('./handoff.js');

  // After handoff.ts's own hook, so by the time a memo turn's exit is seen
  // here the new chat has already been started (or the error recorded).
  st.onTurnExit.push((e) => {
    for (const key of [e.jobId, e.chatId]) {
      if (!exits.has(key)) exits.set(key, e);
      waiters.get(key)?.(e);
    }
  });
});

after(() => {
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('check 7b: handoff to max2 writes one memo and opens a linked chat on max2', async () => {
  const oldId = await finishedChat('plan the kitchen: v3 / batch 4?');
  exits.delete(oldId);

  const r = await ho.startHandoff(oldId, 'max2', 'phone');
  assert.equal(r.ok, true, r.ok ? '' : `startHandoff failed: ${r.status} ${r.error}`);
  if (!r.ok) return;

  // Pending until the chain finishes: a second press is refused.
  const again = await ho.startHandoff(oldId, 'max', 'pc');
  assert.equal(!again.ok && again.status, 409);

  const memoExit = await waitExit(r.memoJobId);
  assert.equal(memoExit.internal, true);
  assert.equal(memoExit.chatId, oldId);
  assert.equal(ho.isHandoffPending(oldId), false);

  // Exactly one new file, named `<date> <title, unsafe chars stripped> handoff.md`.
  const files = handoffFiles();
  assert.equal(files.length, 1, `one memo file, got ${files.join(', ')}`);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2} plan the kitchen v3 batch 4 handoff\.md$/);
  const memoPath = path.join(handoffsDir, files[0]);

  // The memo turn ran in the old chat, on its own tier, with the exact line.
  const oldTurns = logFor(oldId);
  assert.equal(oldTurns.length, 2);
  const memoPrompt = oldTurns[1].stdinPrompt ?? oldTurns[1].argv[oldTurns[1].argv.indexOf('-p') + 1];
  assert.ok(memoPrompt.split('\n').includes(`Write the memo to: ${memoPath}`));
  assert.ok(oldTurns[1].argv.includes('--resume'));
  assert.equal(oldTurns[1].CLAUDE_CONFIG_DIR, null);

  // The old chat links to a new chat on max2, whose first message names the memo.
  const old = store.getChat(oldId);
  assert.ok(old?.handedOffTo, 'old chat has handedOffTo');
  assert.equal(old.handoffError, undefined);
  const newId = old.handedOffTo;
  const fresh = store.getChat(newId);
  assert.ok(fresh);
  assert.equal(fresh.tier, 'max2');
  assert.equal(fresh.account, 'max2');
  assert.equal(fresh.handedOffFrom, oldId);
  assert.equal(fresh.firstMessage, `Continue from the handoff memo at ${memoPath}. Read it first.`);

  // The new chat's turn ran on the Max 2 seat.
  await waitExit(newId);
  const [newTurn] = logFor(newId);
  assert.ok(newTurn, 'the new chat ran a turn');
  assert.equal(newTurn.CLAUDE_CONFIG_DIR, max2Dir);
  assert.ok(newTurn.argv.includes('--session-id'));

  // Still exactly one memo, and nothing written anywhere else in the vault.
  assert.deepEqual(handoffFiles(), files);
  assert.deepEqual(fs.readdirSync(vaultDir), ['06 - Handoffs']);

  // The memo turn never pinged; the old chat's own turn and the new chat did.
  await waitFor(() => pingedChats().includes(newId), 'the new chat to ping');
  assert.equal(pingedChats().filter((id) => id === oldId).length, 1);
});

test('finding 6: a new handoff clears the PREVIOUS attempt\'s handoffError and handedOffTo before its own chain finishes', async () => {
  const oldId = await finishedChat('a chat retrying its handoff');
  exits.delete(oldId);

  // Stand in for a previous attempt's leftover result — a failed first try
  // (handoffError) and, separately, an already-linked handoff (handedOffTo)
  // for the "handing off a second time" case the review also names. Both can
  // never legitimately be set at once in real use, but setting both here
  // proves startHandoff clears whichever is present.
  store.setHandoffError(oldId, 'STALE: the memo was not written');
  store.markHandedOff(oldId, '11111111-2222-3333-4444-555555555555');
  assert.equal(store.getChat(oldId)?.handoffError, 'STALE: the memo was not written');
  assert.equal(store.getChat(oldId)?.handedOffTo, '11111111-2222-3333-4444-555555555555');

  const r = await ho.startHandoff(oldId, 'max2', 'phone');
  assert.equal(r.ok, true, r.ok ? '' : `startHandoff failed: ${r.status} ${r.error}`);
  if (!r.ok) return;

  // The whole point: cleared the moment the handoff starts, not once its own
  // chain finishes — a client polling chatInfo in this exact window must not
  // see the OLD attempt's result and mistake it for this attempt's outcome.
  const duringChain = store.getChat(oldId);
  assert.equal(duringChain?.handoffError, undefined, 'the stale error must already be gone');
  assert.equal(duringChain?.handedOffTo, undefined, 'the stale link must already be gone');

  await waitExit(r.memoJobId);
  // The real new link lands once the chain actually finishes.
  const after = store.getChat(oldId);
  assert.ok(after?.handedOffTo, 'the real handoff still completes');
  assert.notEqual(after?.handedOffTo, '11111111-2222-3333-4444-555555555555');

  // Wait out the new chat's own turn too, so no background activity from
  // this test's handoff chain is still in flight once the test returns (the
  // same reason check 7b above waits for `newId`, not just the memo job).
  await waitExit(after!.handedOffTo!);
});

test('handoff is refused with 409 while a turn runs, and 404 for unknown or deleted chats', async () => {
  const id = await finishedChat('a chat that is busy');
  exits.delete(id);
  const r = await st.startTurn({ message: 'still going', tier: 'max', chatId: id, device: 'pc' });
  assert.equal(r.ok, true);
  assert.equal(lock.isSessionLocked(id), true);

  const before = handoffFiles().length;
  const refused = await ho.startHandoff(id, 'max2', 'phone');
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 409);
  assert.equal(ho.isHandoffPending(id), false);
  if (r.ok) await waitExit(r.jobId);
  assert.equal(handoffFiles().length, before);
  assert.equal(logFor(id).length, 2, 'no memo turn was spawned');

  const unknown = await ho.startHandoff('11111111-2222-3333-4444-555555555555', 'max', 'pc');
  assert.equal(!unknown.ok && unknown.status, 404);

  store.deleteChat(id);
  const deleted = await ho.startHandoff(id, 'max', 'pc');
  assert.equal(!deleted.ok && deleted.status, 404);
});

test('a memo turn that writes no memo sets handoffError and starts nothing', async () => {
  const oldId = await finishedChat('a chat whose seat is at its limit');
  exits.delete(oldId);
  const chatsBefore = store.listChats().length + store.listChats({ archived: true }).length;
  const filesBefore = handoffFiles();

  process.env.FAKE_SKIP_MEMO = '1';
  try {
    const r = await ho.startHandoff(oldId, 'max2', 'phone');
    assert.equal(r.ok, true, r.ok ? '' : `startHandoff failed: ${r.status} ${r.error}`);
    if (!r.ok) return;
    await waitExit(r.memoJobId);
  } finally {
    delete process.env.FAKE_SKIP_MEMO;
  }

  const old = store.getChat(oldId);
  assert.ok(old);
  assert.match(old.handoffError ?? '', /memo was not written/);
  assert.equal(old.handedOffTo, undefined);
  assert.equal(ho.isHandoffPending(oldId), false);
  assert.deepEqual(handoffFiles(), filesBefore);
  assert.equal(
    store.listChats().length + store.listChats({ archived: true }).length,
    chatsBefore,
    'no new chat was created',
  );
});

test('handoffChildTitle: the parent name plus one (handoff), never two', () => {
  assert.equal(ho.handoffChildTitle('Plan the kitchen extension'), 'Plan the kitchen extension (handoff)');
  // Handing off a handoff must not stack the suffix.
  assert.equal(ho.handoffChildTitle('Plan the kitchen extension (handoff)'), 'Plan the kitchen extension (handoff)');
  assert.equal(ho.handoffChildTitle(''), 'Chat (handoff)');
});

test('a handoff child is named after its parent, and the titler leaves that name alone', async () => {
  // Let Haiku titles succeed for this test, so a surviving name proves the
  // titler was skipped rather than that it failed. Restored below: the rest
  // of this file relies on titles failing so the memo file name is known.
  delete process.env.FAKE_TITLE_FAIL;
  process.env.FAKE_TITLE = 'Fake Title';
  try {
    const oldId = await finishedChat('plan the kitchen extension');
    exits.delete(oldId);
    // Settle the parent's own Haiku title first, so the name the child takes
    // over is a known one rather than whatever the race happened to leave.
    await waitFor(() => store.getChat(oldId)?.titleSource === 'haiku', 'the parent to be titled');
    const parentTitle = store.getChat(oldId)?.title ?? '';

    const r = await ho.startHandoff(oldId, 'max', 'phone');
    assert.equal(r.ok, true, r.ok ? '' : `startHandoff failed: ${r.status} ${r.error}`);
    if (!r.ok) return;
    await waitExit(r.memoJobId);

    const newId = store.getChat(oldId)?.handedOffTo;
    assert.ok(newId, 'the old chat has handedOffTo');
    assert.equal(
      store.getChat(newId)?.title,
      `${parentTitle} (handoff)`,
      'the child takes the parent name, not its own memo-path first message',
    );

    // Its own turn has run to exit, which is when the ordinary titler would
    // have renamed it (title mode returns immediately, so half a second is
    // ample for a rename that should not happen).
    await waitExit(newId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(store.getChat(newId)?.title, `${parentTitle} (handoff)`);
    assert.equal(store.getChat(newId)?.titleSource, 'fallback');

    // Control: an ordinary chat in the same run IS titled by Haiku, so this
    // could not pass with the titler broken.
    const control = await finishedChat('an ordinary chat');
    await waitFor(() => store.getChat(control)?.titleSource === 'haiku', 'the control chat to be titled');
    assert.equal(store.getChat(control)?.title, 'Fake Title');
  } finally {
    process.env.FAKE_TITLE_FAIL = '1';
    delete process.env.FAKE_TITLE;
  }
});
