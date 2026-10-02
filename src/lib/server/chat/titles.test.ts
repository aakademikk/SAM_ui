/**
 * SAM — titles.ts: Haiku titles with a first-message fallback.
 *
 * Check 1a. Never calls the real Claude CLI: `SAM_CLAUDE_BIN` points at the
 * fake CLI from T1 (`fakeClaude.ts`), whose title mode is driven entirely by
 * `--model` (containing "haiku") plus the `FAKE_TITLE`/`FAKE_TITLE_FAIL` env
 * vars — see the tickets file's T1 entry. `HOME` is set to a fresh temp dir
 * BEFORE the modules under test are imported, because `chatStore.ts` resolves
 * and caches its store path at first load.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

type ChatStoreModule = typeof import('./chatStore.js');
type TitlesModule = typeof import('./titles.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'titles-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');

let store: ChatStoreModule;
let titles: TitlesModule;

before(async () => {
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  process.env.HOME = home;
  // Never let an inherited CLAUDE_CONFIG_DIR from this shell point the fake
  // CLI's transcript writes (built below, for readHistory's sake) at a real
  // config dir.
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  delete process.env.FAKE_CLAUDE_LOG;
  process.env.FAKE_CLAUDE_DELAY_MS = '0';
  delete process.env.FAKE_CLAUDE_REPLY;
  delete process.env.FAKE_TITLE;
  delete process.env.FAKE_TITLE_FAIL;
  assert.equal(os.homedir(), home);

  store = await import('./chatStore.js');
  titles = await import('./titles.js');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Writes a transcript for `chatId` the way a real first turn would, using
 *  the fake CLI directly (no JobManager/systemd-run needed — titles.ts only
 *  ever reads the transcript back via `readHistory`, it never starts a
 *  turn). Mirrors the recipe startTurn.test.ts's pre-upgrade case uses. */
function buildTranscript(chatId: string, firstMessage: string): void {
  const made = spawnSync(
    process.env.SAM_CLAUDE_BIN as string,
    ['-p', firstMessage, '--session-id', chatId],
    { cwd: agentDir, env: { ...process.env }, encoding: 'utf8' },
  );
  assert.equal(made.status, 0, made.stderr);
}

/** Polls `logPath` until it holds `count` fake-CLI log lines, or throws.
 *  The fake CLI appends its line at start, BEFORE its delay, so a line is
 *  proof that call has already begun — the deterministic signal the ordering
 *  test below needs, in place of a sleep that merely guessed at it. */
async function waitForLogLines(logPath: string, count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length
      : 0;
    if (lines >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`fake CLI log never reached ${count} line(s) (has ${lines})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/* ========================================================================== */
/* fallbackTitle                                                             */
/* ========================================================================== */

test('fallbackTitle: empty or whitespace-only gives "New chat"', () => {
  assert.equal(titles.fallbackTitle(''), 'New chat');
  assert.equal(titles.fallbackTitle('   \n\t  '), 'New chat');
});

test('fallbackTitle: collapses whitespace and leaves a short message as-is', () => {
  assert.equal(titles.fallbackTitle('Kitchen  quote\nstatus'), 'Kitchen quote status');
});

test('fallbackTitle: cuts a long message at a word boundary to 48 chars or fewer, with …', () => {
  const long =
    'Please call the Parkfords about the kitchen quote and the bathroom tiles before Friday afternoon';
  const cut = titles.fallbackTitle(long);
  assert.ok(cut.length <= 48, `expected <= 48 chars, got ${cut.length}: ${cut}`);
  assert.ok(cut.endsWith('…'));
  assert.ok(long.startsWith(cut.slice(0, -1).trimEnd()));
});

/* ========================================================================== */
/* queueTitle (check 1a)                                                     */
/* ========================================================================== */

test('queueTitle: FAKE_TITLE gives a haiku title of 8 words or fewer', async () => {
  const id = 'chat-haiku-ok';
  const firstMessage = 'What is the kitchen quote status';
  buildTranscript(id, firstMessage);
  store.createChat({
    id,
    tier: 'max',
    account: 'main',
    firstMessage,
    title: titles.fallbackTitle(firstMessage),
    titleSource: 'fallback',
  });

  process.env.FAKE_TITLE = 'Kitchen v3 B4 status';
  delete process.env.FAKE_TITLE_FAIL;
  await titles.queueTitle(id);

  const rec = store.getChat(id);
  assert.ok(rec);
  assert.equal(rec.titleSource, 'haiku');
  assert.equal(rec.title, 'Kitchen v3 B4 status');
  assert.ok(rec.title.split(/\s+/).length <= 8);
  assert.equal(rec.titleTries, 0);
});

test('queueTitle: a 20-word FAKE_TITLE is cut to 8 words', async () => {
  const id = 'chat-haiku-long';
  const firstMessage = 'Another message entirely';
  buildTranscript(id, firstMessage);
  store.createChat({
    id,
    tier: 'max',
    account: 'main',
    firstMessage,
    title: titles.fallbackTitle(firstMessage),
    titleSource: 'fallback',
  });

  const words20 = Array.from({ length: 20 }, (_, i) => `word${i + 1}`).join(' ');
  process.env.FAKE_TITLE = words20;
  delete process.env.FAKE_TITLE_FAIL;
  await titles.queueTitle(id);

  const rec = store.getChat(id);
  assert.ok(rec);
  assert.equal(rec.titleSource, 'haiku');
  assert.equal(rec.title.split(/\s+/).length, 8);
  assert.equal(rec.title, words20.split(' ').slice(0, 8).join(' '));
});

test('queueTitle: FAKE_TITLE_FAIL leaves the fallback title (cut-short first message) and increments titleTries', async () => {
  const id = 'chat-haiku-fail';
  const firstMessage =
    'Please call the Parkfords about the kitchen quote and the bathroom tiles before Friday afternoon';
  buildTranscript(id, firstMessage);
  const fallback = titles.fallbackTitle(firstMessage);
  store.createChat({
    id,
    tier: 'max',
    account: 'main',
    firstMessage,
    title: fallback,
    titleSource: 'fallback',
  });

  delete process.env.FAKE_TITLE;
  process.env.FAKE_TITLE_FAIL = '1';
  await titles.queueTitle(id);

  const rec = store.getChat(id);
  assert.ok(rec);
  assert.equal(rec.titleSource, 'fallback');
  assert.equal(rec.title, fallback);
  assert.equal(rec.titleTries, 1);
});

test('queueTitle: two chats queued at once each settle with their own title', async () => {
  const idA = 'chat-queue-a';
  const idB = 'chat-queue-b';
  buildTranscript(idA, 'Message A');
  buildTranscript(idB, 'Message B');
  store.createChat({ id: idA, tier: 'max', account: 'main', firstMessage: 'Message A', title: 'Message A' });
  store.createChat({ id: idB, tier: 'max', account: 'main', firstMessage: 'Message B', title: 'Message B' });

  process.env.FAKE_TITLE = 'Shared Title Text';
  delete process.env.FAKE_TITLE_FAIL;

  await Promise.all([titles.queueTitle(idA), titles.queueTitle(idB)]);

  assert.equal(store.getChat(idA)?.titleSource, 'haiku');
  assert.equal(store.getChat(idA)?.title, 'Shared Title Text');
  assert.equal(store.getChat(idB)?.titleSource, 'haiku');
  assert.equal(store.getChat(idB)?.title, 'Shared Title Text');
});

test('queueTitle: a chat with no store record is a no-op', async () => {
  await titles.queueTitle('11111111-2222-3333-4444-555555555555');
  assert.equal(store.getChat('11111111-2222-3333-4444-555555555555'), null);
});

test('finding 10: a live (default) queueTitle call jumps ahead of an already-queued background backlog', async () => {
  const logPath = path.join(tmp, 'queue-order.log');
  const ids = { bg1: 'chat-bg-1', bg2: 'chat-bg-2', bg3: 'chat-bg-3', live: 'chat-live' };
  // Transcripts built BEFORE FAKE_CLAUDE_LOG is set — buildTranscript spawns
  // the fake CLI too, and its log line would otherwise land in the same file
  // and be mistaken for one of the title calls this test is ordering.
  for (const [key, id] of Object.entries(ids)) {
    buildTranscript(id, `message for ${key}`);
    store.createChat({ id, tier: 'max', account: 'main', firstMessage: `message for ${key}`, title: key });
  }

  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.FAKE_TITLE = 'Shared Title';
  delete process.env.FAKE_TITLE_FAIL;
  // Each title call sleeps, so the live call queued while bg1 is still
  // running has something to jump ahead of. Deliberately long (1 s): the
  // test now waits for bg1 to actually start (below), so the only way this
  // window can be missed is a >1 s stall of the event loop between noticing
  // that start and queueing the live call. It replaces a fixed 60 ms sleep —
  // on a loaded 2-core CI runner that sleep could overshoot the whole
  // backlog and leave the live call queued dead last, which is the failure
  // that made CI red from 2026-10-01.
  process.env.FAKE_CLAUDE_DELAY_MS = '1000';

  try {
    const pending = [
      titles.queueTitle(ids.bg1, { background: true }),
      titles.queueTitle(ids.bg2, { background: true }),
      titles.queueTitle(ids.bg3, { background: true }),
    ];
    // Deterministic, not timed: wait until bg1 is provably running. One log
    // line means bg1 has been dequeued and spawned, so bg2/bg3 are still
    // queued behind it and the live call queued now must run immediately
    // after bg1 — 2nd at worst, never 4th.
    await waitForLogLines(logPath, 1);
    const live = titles.queueTitle(ids.live);

    await Promise.all([...pending, live]);
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
    delete process.env.FAKE_CLAUDE_DELAY_MS;
  }

  // Invocation order, from the fake CLI's own log — each call's prompt
  // literally contains "message for <key>" (buildPrompt embeds firstMessage,
  // and each test chat's firstMessage IS that string), so matching on it
  // directly avoids any ambiguity about which call is which.
  const prompts = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { argv: string[] })
    .map((entry) => entry.argv[entry.argv.indexOf('-p') + 1]);
  const invoked = prompts.map((prompt) => Object.keys(ids).find((key) => prompt.includes(`message for ${key}`)));

  // bg1 was already running when `live` was queued, so it cannot be
  // pre-empted — but `live` must run immediately after it, before bg2/bg3.
  // Before this fix (a single FIFO queue), `live` ran 4th, dead last.
  const liveIndex = invoked.indexOf('live');
  assert.ok(liveIndex >= 0 && liveIndex <= 1, `expected the live call to run 1st or 2nd, got order: ${invoked.join(', ')}`);
  assert.ok(invoked.indexOf('bg2') > liveIndex, 'bg2 must run after the live call');
  assert.ok(invoked.indexOf('bg3') > liveIndex, 'bg3 must run after the live call');

  // All four still got their title — priority only reorders, it never drops.
  for (const id of Object.values(ids)) {
    assert.equal(store.getChat(id)?.titleSource, 'haiku');
  }
});
