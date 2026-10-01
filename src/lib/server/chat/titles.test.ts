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
