/**
 * SAM — transcripts.ts: finding a transcript, replaying it into ChatMessages,
 * and inferring a chat's tier from it.
 *
 * Every test points HOME at a fresh temp dir before writing any fixture, so
 * this never reads Colin's real ~/.claude or ~/.claude-max2. transcripts.ts
 * resolves every path (os.homedir(), agentCwd(), max2ConfigDir()) at call
 * time rather than at module load, so — unlike chatStore.ts — there is no
 * cache to reset between tests; reassigning HOME is enough.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

let transcripts: typeof import('./transcripts.js');
const ready = (async () => {
  transcripts = await import('./transcripts.js');
})();

let sideMessageLog: typeof import('./sideMessageLog.js');
const sideMessageLogReady = (async () => {
  sideMessageLog = await import('./sideMessageLog.js');
})();

/** Point HOME at a fresh temp dir. transcripts.ts itself reads os.homedir()
 *  (via agentCwd()) on every call, so no module reset is needed there —
 *  only samuiSessions.ts/chatStore.ts-style globalThis caches need that.
 *  `max2ConfigDir()` (tiers.ts) is different: its default is a module-level
 *  `const` built from `os.homedir()` at import time (like `REGISTRY_FILE` in
 *  samuiSessions.ts), so it keeps pointing at whatever HOME was live when
 *  the test runner first imported tiers.ts, not this test's fresh one.
 *  `SAM_MAX2_CONFIG_DIR` is the one seam that still lets a test redirect it —
 *  point it inside this fixture's own home explicitly. */
function freshHome(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transcripts-home-'));
  process.env.HOME = tmp;
  delete process.env.SAM_AGENT_CWD;
  process.env.SAM_MAX2_CONFIG_DIR = path.join(tmp, '.claude-max2');
  return tmp;
}

/** The slug a chat under the default agentCwd() (`<HOME>/claude`) writes to —
 *  mirrors cwdSlug's own rule, kept independent here so the test does not
 *  merely echo the implementation back at itself for the one thing that
 *  matters (where fixtures must land on disk). */
function defaultSlug(home: string): string {
  return path.join(home, 'claude').replace(/[^A-Za-z0-9]/g, '-');
}

/** Writes a fixture transcript's entries as JSON lines under `<home>/<configDirName>/projects/<slug>/<id>.jsonl`. */
function writeTranscript(
  home: string,
  configDirName: '.claude' | '.claude-max2',
  slug: string,
  id: string,
  entries: unknown[],
): void {
  const dir = path.join(home, configDirName, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/* -------------------------------------------------------------------------- */
/* readHistory                                                                 */
/* -------------------------------------------------------------------------- */

test('readHistory: a two-turn chat with a tool call reads back as 4 messages, tool result attached', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);
  const id = 'chat-tool-1';

  writeTranscript(home, '.claude', slug, id, [
    // Turn 1's prompt.
    { type: 'user', message: { role: 'user', content: 'What files are here?' }, sessionId: id, uuid: 'u1' },
    // Turn 1's assistant reaches for a tool first.
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
      },
      sessionId: id,
      uuid: 'a1',
    },
    // The tool's result — still `type: 'user'`, but not a fresh prompt.
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1.txt\nfile2.txt' }],
      },
      sessionId: id,
      uuid: 'u1b',
    },
    // Turn 1's final answer.
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'Here are the files: file1.txt, file2.txt' }],
      },
      sessionId: id,
      uuid: 'a2',
    },
    // Bookkeeping entries a real transcript mixes in — none of these should
    // produce a message or split a turn.
    { type: 'system', subtype: 'compact', sessionId: id },
    { type: 'queue-operation', operation: 'add', sessionId: id },
    { type: 'attachment', attachment: {}, sessionId: id },
    { type: 'mode', mode: 'default', sessionId: id },
    { type: 'last-prompt', lastPrompt: 'x', leafUuid: 'a2', sessionId: id },
    // The CLI's own injected note about an image — `type: 'user'`, string
    // content, but isMeta, so it must not be read as a real prompt.
    {
      type: 'user',
      isMeta: true,
      message: { role: 'user', content: '[Image: original 2296x4080, displayed at 1125x2000.]' },
      sessionId: id,
      uuid: 'meta1',
    },
    // A sub-agent's own turn — isSidechain — must not be read as one either.
    {
      type: 'user',
      isSidechain: true,
      message: { role: 'user', content: 'What does this sub-agent think?' },
      sessionId: id,
      uuid: 'side1',
    },
    // Turn 2.
    { type: 'user', message: { role: 'user', content: 'Thanks!' }, sessionId: id, uuid: 'u2' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: "You're welcome!" }] },
      sessionId: id,
      uuid: 'a3',
    },
  ]);

  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 4);

  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].id, 'u1');
  assert.deepEqual(messages[0].blocks, [{ kind: 'text', text: 'What files are here?' }]);
  assert.equal(messages[0].done, true);

  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].id, 'a2');
  assert.equal(messages[1].done, true);
  assert.equal(messages[1].blocks.length, 2);
  const toolBlock = messages[1].blocks[0];
  assert.equal(toolBlock.kind, 'tool');
  if (toolBlock.kind === 'tool') {
    assert.equal(toolBlock.id, 'toolu_1');
    assert.equal(toolBlock.name, 'Bash');
    assert.deepEqual(toolBlock.input, { command: 'ls' });
    assert.equal(toolBlock.status, 'ok');
    assert.equal(toolBlock.result, 'file1.txt\nfile2.txt');
  }
  const textBlock = messages[1].blocks[1];
  assert.equal(textBlock.kind, 'text');
  if (textBlock.kind === 'text') {
    assert.equal(textBlock.text, 'Here are the files: file1.txt, file2.txt');
  }

  assert.equal(messages[2].role, 'user');
  assert.equal(messages[2].id, 'u2');
  assert.deepEqual(messages[2].blocks, [{ kind: 'text', text: 'Thanks!' }]);

  assert.equal(messages[3].role, 'assistant');
  assert.equal(messages[3].id, 'a3');
  assert.deepEqual(messages[3].blocks, [{ kind: 'text', text: "You're welcome!" }]);
});

test('readHistory: a chat id with no transcript on disk returns an empty list', async () => {
  await ready;
  freshHome();
  assert.deepEqual(transcripts.readHistory('no-such-chat'), []);
});

/* -------------------------------------------------------------------------- */
/* T8: side messages survive a reload                                         */
/* -------------------------------------------------------------------------- */

/** Mirrors the real CLI's own shape for a side message landing mid-turn
 *  (SAM's probe, 2026-10-03, /tmp/btw-queued-command-line.json, large
 *  `rendered` field removed) — only the fields transcripts.ts reads matter
 *  for this fixture; the rest ride along for realism. */
function queuedCommandEntry(id: string, parentUuid: string, uuid: string, text: string): unknown {
  return {
    parentUuid,
    isSidechain: false,
    attachment: {
      type: 'queued_command',
      prompt: [{ type: 'text', text }],
      source_uuid: `src-${uuid}`,
      commandMode: 'prompt',
      timestamp: new Date().toISOString(),
    },
    type: 'attachment',
    uuid,
    timestamp: new Date().toISOString(),
    sessionId: id,
  };
}

test('readHistory (T8 R1): a mid-turn queued_command attachment renders as a side block between assistant texts', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);
  const id = 'chat-midturn-side-1';

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'Start the long task' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Working on it...' }] },
      sessionId: id,
      uuid: 'a1',
    },
    queuedCommandEntry(id, 'a1', 'side-att-1', 'also check the logs'),
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'Done, logs look fine.' }],
      },
      sessionId: id,
      uuid: 'a2',
    },
  ]);

  // Fails before T8 R1: relevantEntries drops every attachment, so the side
  // text is simply absent (not even a split — this is one turn either way).
  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 2, 'one user/assistant pair, not split by the attachment');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
  assert.deepEqual(messages[1].blocks, [
    { kind: 'text', text: 'Working on it...' },
    { kind: 'side', text: 'also check the logs' },
    { kind: 'text', text: 'Done, logs look fine.' },
  ]);
});

test('readHistory + tagSideMessages (T8 R2): a late side message, matched via sideMessageLog, stays in its turn as a side block', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-late-side-1';
  const sideText = 'what about the logs too';

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'Start the long task' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'first answer' }] },
      sessionId: id,
      uuid: 'a1',
    },
    // A side message's own entry is written by the CLI in exactly the shape
    // of a fresh top-level prompt (array content, same as streamJsonUserLine
    // writes) — the only thing that tells it apart is T5's own record of
    // having sent it (sideMessageLog.ts).
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: sideText }] },
      sessionId: id,
      uuid: 'u-side',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'second answer' }] },
      sessionId: id,
      uuid: 'a2',
    },
  ]);

  sideMessageLog.recordSideMessageSent(id, sideText);
  transcripts.tagSideMessages(id);

  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 2, 'one user/assistant pair, not split at the tagged entry');
  assert.deepEqual(messages[1].blocks, [
    { kind: 'text', text: 'first answer' },
    { kind: 'side', text: sideText },
    { kind: 'text', text: 'second answer' },
  ]);
});

test('readHistory (T8 "before" baseline): without recordSideMessageSent/tagSideMessages, the same fixture splits into two turns', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-late-side-baseline-1';
  const sideText = 'what about the logs too';

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'Start the long task' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'first answer' }] },
      sessionId: id,
      uuid: 'a1',
    },
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: sideText }] },
      sessionId: id,
      uuid: 'u-side',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'second answer' }] },
      sessionId: id,
      uuid: 'a2',
    },
  ]);

  // recordSideMessageSent/tagSideMessages deliberately skipped — today's
  // wrong behaviour, kept as the explicit "before" baseline.
  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 4, 'the mid-turn-shaped entry wrongly splits into a second turn');
});

test('readHistory + tagSideMessages (T8 R4c): a mid-turn attachment and a late tagged side message in one chat each render exactly once', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-both-kinds-1';
  const midText = 'mid turn note';
  const lateText = 'late note';

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'Start' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'one' }] },
      sessionId: id,
      uuid: 'a1',
    },
    queuedCommandEntry(id, 'a1', 'att-1', midText),
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'two' }] },
      sessionId: id,
      uuid: 'a2',
    },
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: lateText }] },
      sessionId: id,
      uuid: 'u-late',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'three' }] },
      sessionId: id,
      uuid: 'a3',
    },
  ]);

  // Both recorded in the side-message log, as sendSideMessage would do
  // regardless of which shape the CLI happened to write each one in —
  // tagSideMessages must resolve the mid-turn one via its own attachment
  // uuid and never also try to match it against a user entry.
  sideMessageLog.recordSideMessageSent(id, midText);
  sideMessageLog.recordSideMessageSent(id, lateText);
  transcripts.tagSideMessages(id);

  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 2, 'one user/assistant pair');
  const sideBlocks = messages[1].blocks.filter((b) => b.kind === 'side');
  assert.equal(sideBlocks.length, 2, 'each side message appears exactly once');
  assert.deepEqual(
    sideBlocks.map((b) => (b.kind === 'side' ? b.text : '')),
    [midText, lateText],
  );
});

test('readHistory (review 1): a task-notification queued_command attachment is not a side message', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);
  const id = 'chat-task-notification-1';

  // The real CLI also writes queued_command attachments for background-task
  // completions: commandMode "task-notification", a plain string prompt of
  // raw XML. They must stay invisible, exactly as before side messages existed.
  const taskNotification = {
    parentUuid: 'a1',
    isSidechain: false,
    attachment: {
      type: 'queued_command',
      prompt: '<task-notification>\n<task-id>bx1</task-id>\n<status>completed</status>\n</task-notification>',
      source_uuid: 'src-tn-1',
      commandMode: 'task-notification',
      timestamp: new Date().toISOString(),
    },
    type: 'attachment',
    uuid: 'tn-1',
    timestamp: new Date().toISOString(),
    sessionId: id,
  };

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'Run the build in the background' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Started it.' }] },
      sessionId: id,
      uuid: 'a1',
    },
    taskNotification,
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'The build finished.' }] },
      sessionId: id,
      uuid: 'a2',
    },
  ]);

  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 2);
  assert.equal(
    messages[1].blocks.some((b) => b.kind === 'side'),
    false,
    'a background-task notification must not render as a side block',
  );
  // Adjacent assistant text merges into one block, as it always has.
  assert.deepEqual(messages[1].blocks, [{ kind: 'text', text: 'Started it.\nThe build finished.' }]);
});

/** One user/assistant pair, for fixtures that need a few turns. */
function turnEntries(id: string, n: number, userText: string, at: string): unknown[] {
  return [
    { type: 'user', message: { role: 'user', content: userText }, sessionId: id, uuid: `u${n}`, timestamp: at },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: `answer ${n}` }] },
      sessionId: id,
      uuid: `a${n}`,
      timestamp: at,
    },
  ];
}

test('tagSideMessages (review 2): a late side message with the same text as an older, ordinary message tags the late one', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-repeated-text-1';
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const now = new Date().toISOString();

  // Turn 2 is an ordinary "yes". Turn 3 is a long check, and a late side
  // message "yes" is sent into it.
  writeTranscript(home, '.claude', slug, id, [
    ...turnEntries(id, 1, 'plan the deploy', hourAgo),
    ...turnEntries(id, 2, 'yes', hourAgo),
    ...turnEntries(id, 3, 'run the long check', hourAgo),
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'yes' }] }, sessionId: id, uuid: 'u-side', timestamp: now },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'answer to the side message' }] },
      sessionId: id,
      uuid: 'a-side',
      timestamp: now,
    },
  ]);

  sideMessageLog.recordSideMessageSent(id, 'yes');
  transcripts.tagSideMessages(id);

  assert.deepEqual([...sideMessageLog.taggedUuids(id)], ['u-side'], 'the late entry is tagged, not turn 2');

  const messages = transcripts.readHistory(id);
  assert.equal(messages.length, 6, 'three turns: turn 2 stays an ordinary turn');
  assert.deepEqual(messages[2].blocks, [{ kind: 'text', text: 'yes' }], 'turn 2 is still a normal user message');
  assert.deepEqual(messages[5].blocks, [
    { kind: 'text', text: 'answer 3' },
    { kind: 'side', text: 'yes' },
    { kind: 'text', text: 'answer to the side message' },
  ]);
});

test('tagSideMessages (review 2): only entries after the last tagged one are candidates', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-after-last-tagged-1';
  const now = new Date().toISOString();
  const user = (uuid: string, text: string) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    sessionId: id,
    uuid,
    timestamp: now,
  });

  // Every entry is stamped "now", so timestamps cannot tell the two "ok"s
  // apart: only position can. u-ok-ordinary is an ordinary turn that sits
  // BEFORE the side message already tagged (u-later); the second record "ok"
  // belongs to the entry after it.
  writeTranscript(home, '.claude', slug, id, [
    ...turnEntries(id, 1, 'start', now),
    user('u-ok-ordinary', 'ok'),
    ...turnEntries(id, 3, 'work', now).slice(1),
    user('u-later', 'later'),
    user('u-ok-side', 'ok'),
  ]);

  sideMessageLog.recordSideMessageSent(id, 'later');
  transcripts.tagSideMessages(id);
  assert.deepEqual([...sideMessageLog.taggedUuids(id)], ['u-later']);

  sideMessageLog.recordSideMessageSent(id, 'ok');
  transcripts.tagSideMessages(id);
  assert.deepEqual([...sideMessageLog.taggedUuids(id)].sort(), ['u-later', 'u-ok-side']);
});

test('tagSideMessages (review 2): when a turn ends, records from before its job start that never matched are dropped', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-drop-unresolved-1';

  writeTranscript(home, '.claude', slug, id, turnEntries(id, 1, 'start', new Date().toISOString()));

  // The CLI never wrote an entry for this message ("go").
  sideMessageLog.recordSideMessageSent(id, 'go');
  assert.equal(sideMessageLog.unresolved(id).length, 1);

  // A turn that ended and started after the record was sent: the record is
  // from an earlier turn, so it can never match later.
  const laterJobStart = new Date(Date.now() + 1_000).toISOString();
  transcripts.tagSideMessages(id, laterJobStart);
  assert.deepEqual(sideMessageLog.unresolved(id), [], 'the unmatched record from the earlier turn is gone');
});

test('tagSideMessages (review 2): a record sent during the ending turn is kept even if unmatched', async () => {
  await ready;
  await sideMessageLogReady;
  const home = freshHome();
  sideMessageLog.__resetSideMessageLogForTests();
  const slug = defaultSlug(home);
  const id = 'chat-keep-unresolved-1';

  writeTranscript(home, '.claude', slug, id, turnEntries(id, 1, 'start', new Date().toISOString()));

  const jobStart = new Date(Date.now() - 1_000).toISOString();
  sideMessageLog.recordSideMessageSent(id, 'go');
  transcripts.tagSideMessages(id, jobStart);
  assert.equal(sideMessageLog.unresolved(id).length, 1, 'sent after the job started: kept');
});

/* -------------------------------------------------------------------------- */
/* transcriptPath                                                              */
/* -------------------------------------------------------------------------- */

test('transcriptPath: main account first, then Max 2, then null', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);

  writeTranscript(home, '.claude', slug, 'main-chat', [
    { type: 'user', message: { role: 'user', content: 'hi' }, sessionId: 'main-chat' },
  ]);
  writeTranscript(home, '.claude-max2', slug, 'max2-chat', [
    { type: 'user', message: { role: 'user', content: 'hi' }, sessionId: 'max2-chat' },
  ]);

  const mainFound = transcripts.transcriptPath('main-chat');
  assert.ok(mainFound);
  assert.equal(mainFound?.account, 'main');
  assert.ok(mainFound?.path.includes(path.join('.claude', 'projects')));

  const max2Found = transcripts.transcriptPath('max2-chat');
  assert.ok(max2Found);
  assert.equal(max2Found?.account, 'max2');
  assert.ok(max2Found?.path.includes(path.join('.claude-max2', 'projects')));

  assert.equal(transcripts.transcriptPath('no-such-chat'), null);
});

/* -------------------------------------------------------------------------- */
/* inferTier                                                                   */
/* -------------------------------------------------------------------------- */

test('inferTier: a Max 2 transcript is max2, regardless of its models', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);
  const id = 'chat-max2-1';

  writeTranscript(home, '.claude-max2', slug, id, [
    { type: 'user', message: { role: 'user', content: 'hi' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'hey' }] },
      sessionId: id,
      uuid: 'a1',
    },
  ]);

  assert.deepEqual(transcripts.inferTier(id), { tier: 'max2', account: 'max2' });
});

test('inferTier: a single-model main transcript infers that tier (ignoring <synthetic>)', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);
  const id = 'chat-fast-1';

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'q1' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'deepseek-flash', content: [{ type: 'text', text: 'a1' }] },
      sessionId: id,
      uuid: 'a1',
    },
    { type: 'user', message: { role: 'user', content: 'q2' }, sessionId: id, uuid: 'u2' },
    {
      // A compaction/summarisation turn — must not count as a second model.
      type: 'assistant',
      message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'summary' }] },
      sessionId: id,
      uuid: 'a2',
    },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'deepseek-flash', content: [{ type: 'text', text: 'a2' }] },
      sessionId: id,
      uuid: 'a3',
    },
  ]);

  assert.deepEqual(transcripts.inferTier(id), { tier: 'fast', account: 'main' });
});

test('inferTier: deepseek-v4-pro maps to pro, gemini* to gemini, claude-* to max', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);

  writeTranscript(home, '.claude', slug, 'chat-pro-1', [
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'deepseek-v4-pro', content: [{ type: 'text', text: 'a' }] },
      sessionId: 'chat-pro-1',
      uuid: 'a1',
    },
  ]);
  writeTranscript(home, '.claude', slug, 'chat-gemini-1', [
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'gemini-3.7-flash', content: [{ type: 'text', text: 'a' }] },
      sessionId: 'chat-gemini-1',
      uuid: 'a1',
    },
  ]);
  writeTranscript(home, '.claude', slug, 'chat-max-1', [
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'a' }] },
      sessionId: 'chat-max-1',
      uuid: 'a1',
    },
  ]);

  assert.deepEqual(transcripts.inferTier('chat-pro-1'), { tier: 'pro', account: 'main' });
  assert.deepEqual(transcripts.inferTier('chat-gemini-1'), { tier: 'gemini', account: 'main' });
  assert.deepEqual(transcripts.inferTier('chat-max-1'), { tier: 'max', account: 'main' });
});

test('inferTier: a mixed-model main transcript (tier chosen per message, pre-upgrade) gives unknown', async () => {
  await ready;
  const home = freshHome();
  const slug = defaultSlug(home);
  const id = 'chat-mixed-1';

  writeTranscript(home, '.claude', slug, id, [
    { type: 'user', message: { role: 'user', content: 'q1' }, sessionId: id, uuid: 'u1' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'deepseek-flash', content: [{ type: 'text', text: 'a1' }] },
      sessionId: id,
      uuid: 'a1',
    },
    { type: 'user', message: { role: 'user', content: 'q2' }, sessionId: id, uuid: 'u2' },
    {
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'a2' }] },
      sessionId: id,
      uuid: 'a2',
    },
  ]);

  assert.deepEqual(transcripts.inferTier(id), { tier: 'unknown', account: 'main' });
});

test('inferTier: a chat id with no transcript on disk returns null', async () => {
  await ready;
  freshHome();
  assert.equal(transcripts.inferTier('no-such-chat'), null);
});
