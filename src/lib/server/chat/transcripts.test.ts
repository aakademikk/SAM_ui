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
