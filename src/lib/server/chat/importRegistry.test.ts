/**
 * SAM — importRegistryChats: the old session registry's chats land in
 * Archived (T8, spec must-do 14a, check 10a).
 *
 * The registry fixture here is 4 ids: one on the main account with a single
 * model throughout (infers a known tier), one on Max 2, one on main with a
 * mixed model history (infers `unknown`), and one with no transcript at all
 * (never imported). The first three transcripts are written directly as
 * JSONL fixtures (the same recipe transcripts.test.ts uses) so their models
 * and timestamps are exact and deterministic — the fake CLI's own transcript
 * writer never sets `message.model`, which `inferTier` needs.
 *
 * `adopt`, `restore` and `startTurn` are exercised afterwards through the
 * real `JobManager` (`systemd-run --user --scope`) against the fake CLI, the
 * same setup startTurn.test.ts and chatActions.test.ts use, to prove a
 * restored import actually resumes — a real spawn, never a stub. If
 * `systemd-run --user` is unavailable this file fails loudly, never skips.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { writeFakeClaude } from '@/lib/server/testing/fakeClaude';

type ImportModule = typeof import('./importRegistry.js');
type ActionsModule = typeof import('./chatActions.js');
type StartTurnModule = typeof import('./startTurn.js');
type ChatStoreModule = typeof import('./chatStore.js');
type ManagerModule = typeof import('../jobs/manager.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-registry-'));
const home = path.join(tmp, 'home');
const agentDir = path.join(tmp, 'agent-cwd');
const max2Dir = path.join(tmp, 'claude-max2');
const pushSubs = path.join(tmp, 'push-subs.json');

let importRegistry: ImportModule;
let actions: ActionsModule;
let st: StartTurnModule;
let store: ChatStoreModule;
let manager: ManagerModule;

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

/** Mirrors transcripts.ts's cwdSlug: every character that is not a letter
 *  or digit becomes "-". */
function cwdSlug(dir: string): string {
  return dir.replace(/[^A-Za-z0-9]/g, '-');
}

function writeTranscript(configDir: string, slug: string, id: string, entries: unknown[]): void {
  const dir = path.join(configDir, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

interface LogEntry {
  argv: string[];
  CLAUDE_CONFIG_DIR: string | null;
  SAM_CHAT_ID: string | null;
}

/** Turn spawns only. T7's exit hook (and this import's own queueTitle calls)
 *  fire background Haiku title calls through the same fake CLI; those carry
 *  `--no-session-persistence` and no `SAM_CHAT_ID`, so they are filtered out
 *  the same way startTurn.test.ts's readLog() does. */
function readTurnLog(logPath: string): LogEntry[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry)
    .filter((e) => !e.argv.includes('--no-session-persistence'));
}

function writeRegistry(ids: string[]): void {
  const file = path.join(home, '.sam', 'samui-sessions.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ids));
}

/* Four registry ids, valid-looking session UUIDs (startTurn's
   validSessionId requires the shape when one is resumed later). */
const idMain = 'aaaaaaaa-0000-0000-0000-000000000001'; // main, single model -> known tier
const idMax2 = 'bbbbbbbb-0000-0000-0000-000000000002'; // Max 2
const idMixed = 'cccccccc-0000-0000-0000-000000000003'; // main, mixed models -> unknown
const idNoTranscript = 'dddddddd-0000-0000-0000-000000000004'; // registry only, no transcript

const MAIN_CREATED_AT = '2026-01-01T00:00:00.000Z';
const MAIN_LAST_ACTIVE_AT = '2026-01-01T00:05:00.000Z';

before(async () => {
  const probe = spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', 'true'], {
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `systemd-run --user --scope is unavailable; importRegistry.test needs it. ${probe.error ?? ''} ${probe.stderr ?? ''}`,
  );

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(max2Dir, { recursive: true });
  fs.writeFileSync(pushSubs, '[]');

  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.SAM_AGENT_CWD = agentDir;
  process.env.SAM_MAX2_CONFIG_DIR = max2Dir;
  process.env.SAM_PUSH_SUBS = pushSubs;
  process.env.SAM_CLAUDE_BIN = writeFakeClaude(path.join(tmp, 'bin'));
  delete process.env.FAKE_CLAUDE_LOG;
  process.env.FAKE_CLAUDE_DELAY_MS = '0';
  // FAKE_TITLE_FAIL unset: the background title queue runs for real against
  // the fake CLI and must not touch a real Haiku call.
  delete process.env.FAKE_CLAUDE_REPLY;
  process.env.FLEET_COST_URL = 'http://127.0.0.1:9/none';
  assert.equal(os.homedir(), home);

  // Fixture transcripts, written directly (not through the fake CLI, which
  // never sets message.model) so inferTier's model-based rules are exact.
  const slug = cwdSlug(agentDir);

  writeTranscript(path.join(home, '.claude'), slug, idMain, [
    {
      type: 'user',
      message: { role: 'user', content: 'Kitchen cabinet question for Colin' },
      sessionId: idMain,
      uuid: 'main-u1',
      timestamp: MAIN_CREATED_AT,
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Sure, here is help' }] },
      sessionId: idMain,
      uuid: 'main-a1',
      timestamp: MAIN_LAST_ACTIVE_AT,
    },
  ]);

  writeTranscript(max2Dir, slug, idMax2, [
    {
      type: 'user',
      message: { role: 'user', content: 'A Max 2 conversation' },
      sessionId: idMax2,
      uuid: 'max2-u1',
      timestamp: '2026-01-02T00:00:00.000Z',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Working on it' }] },
      sessionId: idMax2,
      uuid: 'max2-a1',
      timestamp: '2026-01-02T00:10:00.000Z',
    },
  ]);

  writeTranscript(path.join(home, '.claude'), slug, idMixed, [
    {
      type: 'user',
      message: { role: 'user', content: 'q1 on a mixed chat' },
      sessionId: idMixed,
      uuid: 'mixed-u1',
      timestamp: '2026-01-03T00:00:00.000Z',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'deepseek-flash', content: [{ type: 'text', text: 'a1' }] },
      sessionId: idMixed,
      uuid: 'mixed-a1',
      timestamp: '2026-01-03T00:01:00.000Z',
    },
    {
      type: 'user',
      message: { role: 'user', content: 'q2 on a mixed chat' },
      sessionId: idMixed,
      uuid: 'mixed-u2',
      timestamp: '2026-01-03T00:02:00.000Z',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'a2' }] },
      sessionId: idMixed,
      uuid: 'mixed-a2',
      timestamp: '2026-01-03T00:03:00.000Z',
    },
  ]);

  writeRegistry([idMain, idMax2, idMixed, idNoTranscript]);

  manager = await import('../jobs/manager.js');
  store = await import('./chatStore.js');
  importRegistry = await import('./importRegistry.js');
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

test('import: exactly the 3 ids with a transcript land in Archived, none in the main list', () => {
  importRegistry.importRegistryChats();

  const archived = actions.listChatSummaries({ archived: true });
  const main = actions.listChatSummaries();

  assert.deepEqual(main.map((c) => c.id), []);
  assert.deepEqual(
    archived.map((c) => c.id).sort(),
    [idMain, idMax2, idMixed].sort(),
  );

  // The id with no transcript never gets a record at all.
  assert.equal(store.getChat(idNoTranscript), null);
  assert.equal(store.hasChatRecord(idNoTranscript), false);

  for (const chat of archived) {
    assert.equal(chat.imported, true);
  }
});

test('import: tiers and accounts are inferred correctly', () => {
  const archived = actions.listChatSummaries({ archived: true });
  const max2 = archived.find((c) => c.id === idMax2);
  const mixed = archived.find((c) => c.id === idMixed);
  const main = archived.find((c) => c.id === idMain);

  assert.ok(max2);
  assert.equal(max2?.tier, 'max2');
  assert.equal(max2?.account, 'max2');

  assert.ok(mixed);
  assert.equal(mixed?.tier, 'unknown');
  assert.equal(mixed?.account, 'main');

  assert.ok(main);
  assert.equal(main?.tier, 'max');
  assert.equal(main?.account, 'main');

  // createdAt/lastActiveAt come from the transcript's first and last
  // timestamps, not "now".
  const mainRecord = store.getChat(idMain);
  assert.equal(mainRecord?.createdAt, MAIN_CREATED_AT);
  assert.equal(mainRecord?.lastActiveAt, MAIN_LAST_ACTIVE_AT);
});

test('adopt: adopting one imported chat puts it alone in the main list', () => {
  const result = actions.adopt(idMain);
  assert.equal(result.ok, true);

  const main = actions.listChatSummaries();
  assert.deepEqual(main.map((c) => c.id), [idMain]);

  // The other two imports stay archived.
  const archived = actions.listChatSummaries({ archived: true }).map((c) => c.id);
  assert.deepEqual(archived.sort(), [idMax2, idMixed].sort());
});

test('restore + startTurn on the mixed (unknown-tier, main-account) chat resumes with no CLAUDE_CONFIG_DIR', async () => {
  const restored = actions.restore(idMixed);
  assert.equal(restored.ok, true);
  assert.equal(actions.listChatSummaries().some((c) => c.id === idMixed), true);

  const logPath = path.join(tmp, 'mixed-turn.log');
  process.env.FAKE_CLAUDE_LOG = logPath;
  const r = await st.startTurn({ message: 'carry on', tier: 'fast', chatId: idMixed, device: 'phone' });
  assertOk(r);
  // unknown-tier chats ignore the requested tier and run as max on main.
  assert.equal(r.tier, 'max');
  await waitExit(r.jobId);
  delete process.env.FAKE_CLAUDE_LOG;

  const entries = readTurnLog(logPath).filter((e) => e.SAM_CHAT_ID === idMixed);
  const entry = entries[entries.length - 1];
  assert.ok(entry, 'the turn itself logged (background title calls are filtered out)');
  const resumeIndex = entry.argv.indexOf('--resume');
  assert.ok(resumeIndex >= 0, 'resumes rather than starting fresh');
  assert.equal(entry.argv[resumeIndex + 1], idMixed);
  assert.equal(entry.CLAUDE_CONFIG_DIR, null);
});

test('restore + startTurn on the Max 2 chat resumes with CLAUDE_CONFIG_DIR set to the Max 2 dir', async () => {
  const restored = actions.restore(idMax2);
  assert.equal(restored.ok, true);
  assert.equal(actions.listChatSummaries().some((c) => c.id === idMax2), true);

  const logPath = path.join(tmp, 'max2-turn.log');
  process.env.FAKE_CLAUDE_LOG = logPath;
  const r = await st.startTurn({ message: 'still going', tier: 'max2', chatId: idMax2, device: 'pc' });
  assertOk(r);
  assert.equal(r.tier, 'max2');
  await waitExit(r.jobId);
  delete process.env.FAKE_CLAUDE_LOG;

  const entries = readTurnLog(logPath).filter((e) => e.SAM_CHAT_ID === idMax2);
  const entry = entries[entries.length - 1];
  assert.ok(entry, 'the turn itself logged (background title calls are filtered out)');
  const resumeIndex = entry.argv.indexOf('--resume');
  assert.ok(resumeIndex >= 0, 'resumes rather than starting fresh');
  assert.equal(entry.argv[resumeIndex + 1], idMax2);
  assert.equal(entry.CLAUDE_CONFIG_DIR, max2Dir);
});

test('a second import adds nothing', () => {
  const before = store.listChats({ archived: false }).concat(store.listChats({ archived: true }));
  const beforeIds = before.map((c) => c.id).sort();

  importRegistry.importRegistryChats();

  const after2 = store.listChats({ archived: false }).concat(store.listChats({ archived: true }));
  const afterIds = after2.map((c) => c.id).sort();

  assert.deepEqual(afterIds, beforeIds);
  assert.equal(store.getChat(idNoTranscript), null);
});
