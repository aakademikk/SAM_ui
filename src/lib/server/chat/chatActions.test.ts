/**
 * SAM — chatActions.ts: list, open, archive/restore/delete, adopt.
 *
 * Checks 3, 8 and the API half of 7a. Runs real turns through the real
 * JobManager (`systemd-run --user --scope`) against the fake CLI from T1,
 * the same setup startTurn.test.ts uses — check 3 and check 8's 409-while-
 * running assertion both need a real, lockable turn in flight, not a
 * hand-written store record. All state lives under a temp HOME set BEFORE
 * the modules under test are imported. If `systemd-run --user` is
 * unavailable this file fails loudly — it never skips.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

type ActionsModule = typeof import('./chatActions.js');
type StartTurnModule = typeof import('./startTurn.js');
type ChatStoreModule = typeof import('./chatStore.js');
type SessionLockModule = typeof import('./sessionLock.js');
type TranscriptsModule = typeof import('./transcripts.js');
type SessionsModule = typeof import('./samuiSessions.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-actions-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const pushSubs = path.join(tmp, 'push-subs.json');

let actions: ActionsModule;
let st: StartTurnModule;
let store: ChatStoreModule;
let lock: SessionLockModule;
let transcripts: TranscriptsModule;
let sessions: SessionsModule;
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

function textOf(message: { blocks: { kind: string; text?: string }[] } | undefined): string {
  if (!message) return '';
  const block = message.blocks.find((b) => b.kind === 'text');
  return block?.text ?? '';
}

before(async () => {
  // Fail loudly, never skip: check 8's 409-while-running assertion needs the
  // real spawn path, not a stub.
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; chatActions.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(pushSubs, '[]');

  process.env.HOME = home;
  // See startTurn.test.ts: an inherited CLAUDE_CONFIG_DIR would send these
  // fake turns' transcripts into a real config dir.
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  delete process.env.FAKE_CLAUDE_LOG;
  // A visible delay so the 409-while-running assertions (check 8) have a
  // real window to land in, between "turn started" and "turn exited".
  process.env.FAKE_CLAUDE_DELAY_MS = '1200';
  delete process.env.FAKE_CLAUDE_REPLY;
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  manager = await import('../jobs/manager.js');
  sessions = await import('./samuiSessions.js');
  store = await import('./chatStore.js');
  lock = await import('./sessionLock.js');
  transcripts = await import('./transcripts.js');
  st = await import('./startTurn.js');
  actions = await import('./chatActions.js');

  st.onTurnExit.push((e) => {
    exits.set(e.jobId, e);
    waiters.get(e.jobId)?.(e);
  });
});

after(() => {
  manager?.getJobManager().stopSweep();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('check 3: a chat read back after its turn finishes is identical for two callers, and holds the turn', async () => {
  const started = await st.startTurn({
    message: 'hello check3',
    tier: 'max',
    device: 'phone',
  });
  assertOk(started);
  await waitExit(started.jobId);

  // Two reads, standing in for "once for the phone and once for the PC" —
  // listChatSummaries/openChat take no device argument at all, so calling
  // them twice with nothing but the chat id is the whole test: either they
  // agree, or the read depends on something other than server state.
  const listPhone = actions.listChatSummaries();
  const listPc = actions.listChatSummaries();
  assert.deepEqual(listPhone, listPc);

  const openPhone = actions.openChat(started.chatId);
  const openPc = actions.openChat(started.chatId);
  assert.deepEqual(openPhone, openPc);

  assert.ok(openPhone);
  assert.equal(openPhone.runningJobId, null);
  assert.equal(openPhone.messages.length, 2);
  assert.equal(openPhone.messages[0].role, 'user');
  assert.equal(textOf(openPhone.messages[0]), 'hello check3');
  assert.equal(openPhone.messages[1].role, 'assistant');
  assert.equal(textOf(openPhone.messages[1]), 'echo: hello check3');

  const summary = listPhone.find((c) => c.id === started.chatId);
  assert.ok(summary, 'the finished chat is in the main list');
  assert.equal(summary.running, false);
});

test('check 8: archive hides, restore returns, delete removes from both lists and 404s openChat, transcript stays', async () => {
  const started = await st.startTurn({
    message: 'hello check8',
    tier: 'max',
    device: 'phone',
  });
  assertOk(started);
  await waitExit(started.jobId);
  const id = started.chatId;
  const transcriptFile = transcripts.transcriptPath(id)?.path;
  assert.ok(transcriptFile && fs.existsSync(transcriptFile));

  // Archive: leaves the main list, appears in Archived, still openable.
  const archived = actions.archive(id);
  assert.equal(archived.ok, true);
  assert.equal(actions.listChatSummaries().some((c) => c.id === id), false);
  assert.equal(actions.listChatSummaries({ archived: true }).some((c) => c.id === id), true);
  assert.ok(actions.openChat(id));

  // Restore: back in the main list, gone from Archived.
  const restored = actions.restore(id);
  assert.equal(restored.ok, true);
  assert.equal(actions.listChatSummaries().some((c) => c.id === id), true);
  assert.equal(actions.listChatSummaries({ archived: true }).some((c) => c.id === id), false);

  // Delete: gone from both lists, openChat 404s, transcript file untouched.
  const removed = actions.remove(id);
  assert.equal(removed.ok, true);
  assert.equal(actions.listChatSummaries().some((c) => c.id === id), false);
  assert.equal(actions.listChatSummaries({ archived: true }).some((c) => c.id === id), false);
  assert.equal(actions.openChat(id), null);
  assert.ok(fs.existsSync(transcriptFile as string), 'transcript file still exists on disk');
});

test('delete drops the chat\'s side-message records, and only that chat\'s', async () => {
  const log = await import('./sideMessageLog.js');
  const started = await st.startTurn({ message: 'hello side-log delete', tier: 'max', device: 'phone' });
  assertOk(started);
  await waitExit(started.jobId);

  log.recordSideMessageSent(started.chatId, 'note for the deleted chat');
  log.recordSideMessageSent('some-other-chat', 'note for another chat');
  assert.equal(log.unresolved(started.chatId).length, 1);

  assert.equal(actions.remove(started.chatId).ok, true);

  assert.deepEqual(log.unresolved(started.chatId), [], 'the deleted chat\'s records are gone');
  assert.equal(log.unresolved('some-other-chat').length, 1, 'another chat\'s records are untouched');
});

test('check 8: archive and delete are refused with 409 while the turn is running', async () => {
  const started = await st.startTurn({
    message: 'hello running',
    tier: 'max',
    device: 'pc',
  });
  assertOk(started);
  const id = started.chatId;

  // The fake sleeps FAKE_CLAUDE_DELAY_MS before it writes anything, so the
  // lock is held right now — no race to win here.
  assert.equal(lock.isSessionLocked(id), true);

  const archiveBlocked = actions.archive(id);
  assert.equal(archiveBlocked.ok, false);
  assert.equal(!archiveBlocked.ok && archiveBlocked.status, 409);
  assert.equal(!archiveBlocked.ok && archiveBlocked.error, 'A turn is running in this chat.');

  const removeBlocked = actions.remove(id);
  assert.equal(removeBlocked.ok, false);
  assert.equal(!removeBlocked.ok && removeBlocked.status, 409);
  assert.equal(!removeBlocked.ok && removeBlocked.error, 'A turn is running in this chat.');

  // restore is refused the same way, even though this chat is not archived —
  // guardNotRunning fires before archived-state is even looked at.
  const restoreBlocked = actions.restore(id);
  assert.equal(restoreBlocked.ok, false);
  assert.equal(!restoreBlocked.ok && restoreBlocked.status, 409);

  await waitExit(started.jobId);
  assert.equal(lock.isSessionLocked(id), false);

  // Once the turn has ended, the same call succeeds.
  const archiveOk = actions.archive(id);
  assert.equal(archiveOk.ok, true);
});

test('check 7a: ?q= filters the main list and Archived by title only', async () => {
  store.createChat({
    id: 'q-main-kitchen',
    tier: 'max',
    account: 'main',
    firstMessage: 'Call about the Parkfords job before Friday',
    title: 'Kitchen v3 status',
  });
  store.createChat({
    id: 'q-main-bathroom',
    tier: 'max',
    account: 'main',
    firstMessage: 'unrelated',
    title: 'Bathroom quote',
  });
  store.createChat({
    id: 'q-archived-kitchen',
    tier: 'max',
    account: 'main',
    firstMessage: 'older notes',
    title: 'Kitchen status',
    archived: true,
  });
  store.createChat({
    id: 'q-archived-bathroom',
    tier: 'max',
    account: 'main',
    firstMessage: 'x',
    title: 'Bathroom notes',
    archived: true,
  });

  const mainMatches = actions.listChatSummaries({ q: 'kitchen' });
  assert.deepEqual(mainMatches.map((c) => c.id).sort(), ['q-main-kitchen']);

  const archivedMatches = actions.listChatSummaries({ archived: true, q: 'kitchen' });
  assert.deepEqual(archivedMatches.map((c) => c.id).sort(), ['q-archived-kitchen']);

  // Case-insensitive substring.
  assert.deepEqual(
    actions.listChatSummaries({ q: 'BATHROOM' }).map((c) => c.id),
    ['q-main-bathroom'],
  );

  // A word that only appears inside firstMessage, never the title, matches
  // nothing in either list — filterByTitle (T3) is title-only by contract,
  // and listChatSummaries must not loosen that.
  assert.equal(actions.listChatSummaries({ q: 'Parkfords' }).length, 0);
  assert.equal(actions.listChatSummaries({ archived: true, q: 'Parkfords' }).length, 0);
});

test('finding 3: a runningJobId left over from a restart (no lock held) does not hide the last exchange or hand back a dead job id', async () => {
  const started = await st.startTurn({
    message: 'hello finding3',
    tier: 'max',
    device: 'pc',
  });
  assertOk(started);
  const id = started.chatId;
  await waitExit(started.jobId);
  // The turn finished normally, so onExit already cleared runningJobId and
  // released the lock — simulate a sam-ui restart that happened right after
  // a *different* turn, by writing the field back in with no lock behind it
  // (exactly what a restart mid-turn leaves: the persisted field outlives
  // the in-memory lock, which dies with the process).
  store.setRunningJob(id, 'dead-job-id-from-before-restart');
  assert.equal(lock.isSessionLocked(id), false);

  const opened = actions.openChat(id);
  assert.ok(opened);
  assert.equal(opened.runningJobId, null, 'no dead job id is handed to the client');
  assert.equal(opened.messages.length, 2, 'the last exchange is not hidden');
  assert.equal(opened.messages[0].role, 'user');
  assert.equal(opened.messages[1].role, 'assistant');
  assert.equal(store.getChat(id)?.runningJobId, null, 'the stale field is cleared in the store too');
});

test('finding 7: reattaching before the new turn\'s prompt is even on disk does not hide the previous finished turn', async () => {
  const id = await (async () => {
    const started = await st.startTurn({ message: 'first turn', tier: 'max', device: 'pc' });
    assertOk(started);
    await waitExit(started.jobId);
    return started.chatId;
  })();

  // FAKE_CLAUDE_DELAY_MS is 1200 for this whole file — the fake sleeps that
  // long BEFORE writing anything to the transcript, so calling openChat
  // immediately after startTurn resolves lands well inside the window where
  // the new turn has no entry on disk at all yet.
  const started = await st.startTurn({ message: 'second turn', tier: 'max', chatId: id, device: 'pc' });
  assertOk(started);

  const opened = actions.openChat(id);
  assert.ok(opened);
  assert.equal(opened.runningJobId, started.jobId);
  // Before the fix: slice(0,-2) blindly dropped the trailing pair, which at
  // this instant IS the only (previous, finished) turn on disk — it
  // vanished even though nothing about it is in flight.
  assert.equal(opened.messages.length, 2, 'the previous finished turn must still be shown');
  assert.equal(opened.messages[0].role, 'user');
  assert.equal(opened.messages[1].role, 'assistant');
  // The in-flight question is still surfaced separately, for the client to
  // show above its streaming placeholder.
  assert.ok(opened.pendingPrompt?.includes('second turn'), `expected pendingPrompt to mention the new message, got: ${opened.pendingPrompt}`);

  await waitExit(started.jobId);
  const finished = actions.openChat(id);
  assert.equal(finished?.messages.length, 4, 'once it lands, the new turn is there too');
});

test('finding 7: once the new turn\'s prompt is actually on disk, reattach hides that turn and still returns its prompt text', async () => {
  const id = await (async () => {
    const started = await st.startTurn({ message: 'first turn b', tier: 'max', device: 'pc' });
    assertOk(started);
    await waitExit(started.jobId);
    return started.chatId;
  })();

  // Holds the job "running" with the transcript entries already written —
  // the normal, long middle of any real turn (a real CLI writes the prompt
  // entry well before any reply exists).
  process.env.FAKE_CLAUDE_POST_WRITE_DELAY_MS = '1500';
  try {
    const started = await st.startTurn({ message: 'second turn b', tier: 'max', chatId: id, device: 'pc' });
    assertOk(started);

    // FAKE_CLAUDE_DELAY_MS (1200) elapses, entries get written, then the
    // fake sleeps another 1500ms before exiting — 1800ms lands comfortably
    // inside that second window.
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const opened = actions.openChat(id);
    assert.ok(opened);
    assert.equal(opened.runningJobId, started.jobId);
    // The in-flight pair IS on disk now, and must be hidden (the client
    // replays it live from the job stream instead).
    assert.equal(opened.messages.length, 2, 'only the previous, already-finished turn is shown');
    assert.ok(
      opened.pendingPrompt?.includes('second turn b'),
      `expected pendingPrompt to mention the in-flight message, got: ${opened.pendingPrompt}`,
    );

    await waitExit(started.jobId);
  } finally {
    delete process.env.FAKE_CLAUDE_POST_WRITE_DELAY_MS;
  }
});

test('finding 7 + T8a: a late side message answered by the running job hides the whole in-flight turn, not just its last pair', async () => {
  const id = await (async () => {
    const started = await st.startTurn({ message: 'first turn c', tier: 'max', device: 'pc' });
    assertOk(started);
    await waitExit(started.jobId);
    return started.chatId;
  })();

  process.env.FAKE_CLAUDE_POST_WRITE_DELAY_MS = '3000';
  try {
    const started = await st.startTurn({ message: 'second turn c', tier: 'max', chatId: id, device: 'pc' });
    assertOk(started);

    // Wait for the fake to write the in-flight prompt + first answer.
    await new Promise((resolve) => setTimeout(resolve, 1800));

    // A late side message: an ordinary prompt-shaped user entry, untagged
    // (nothing has recorded it in the side-message log), plus the job's
    // second answer — both after the job's start.
    const found = transcripts.transcriptPath(id);
    assert.ok(found);
    const later = new Date(Date.now() + 1000).toISOString();
    const entry = (type: string, message: object) =>
      JSON.stringify({ type, message, sessionId: id, timestamp: later, uuid: crypto.randomUUID() }) + '\n';
    fs.appendFileSync(found.path, entry('user', { role: 'user', content: 'late side c' }));
    fs.appendFileSync(
      found.path,
      entry('assistant', { role: 'assistant', content: [{ type: 'text', text: 'second answer c' }] }),
    );

    assert.equal(transcripts.readHistory(id).length, 6, 'the late entry reads as its own pair before the fix applies');

    const opened = actions.openChat(id);
    assert.ok(opened);
    assert.equal(opened.runningJobId, started.jobId);
    assert.equal(opened.messages.length, 2, 'only the earlier finished turn is shown');
    assert.equal(textOf(opened.messages[0]), 'first turn c');
    assert.ok(
      !opened.messages.some((m) => textOf(m).includes('second turn c') || textOf(m).includes('late side c')),
      'no part of the in-flight turn is in history',
    );

    await waitExit(started.jobId);
  } finally {
    delete process.env.FAKE_CLAUDE_POST_WRITE_DELAY_MS;
  }
});

test('adopt: refuses an unknown id, adopts a pre-upgrade chat unarchived, and stays idempotent', async () => {
  const unknown = actions.adopt('11111111-2222-3333-4444-555555555555');
  assert.equal(unknown.ok, false);
  assert.equal(!unknown.ok && unknown.status, 404);

  // Build a transcript the way a pre-upgrade device chat left it (same
  // recipe as startTurn.test.ts's pre-upgrade case): run the fake directly,
  // then register the id as SAM_ui-owned, with no store record at all.
  const legacyId = 'cccccccc-1111-2222-3333-444444444444';
  const made = spawnSync(
    process.env.SAM_CLAUDE_BIN as string,
    ['-p', 'an old chat about the kitchen', '--session-id', legacyId],
    { cwd: agentDir, env: { ...process.env, FAKE_CLAUDE_DELAY_MS: '0' }, encoding: 'utf8' },
  );
  assert.equal(made.status, 0, made.stderr);
  sessions.registerSamuiSession(legacyId);
  assert.equal(store.getChat(legacyId), null);

  const adopted = actions.adopt(legacyId);
  assert.equal(adopted.ok, true);
  assert.ok(adopted.ok && adopted.chat.archived === false);
  assert.ok(adopted.ok && adopted.chat.title.length > 0);

  // Idempotent, and always leaves the chat unarchived even if something else
  // archived it in between.
  store.archiveChat(legacyId);
  const reAdopted = actions.adopt(legacyId);
  assert.equal(reAdopted.ok, true);
  assert.ok(reAdopted.ok && reAdopted.chat.archived === false);
});
