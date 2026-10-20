/**
 * SAM — each chat's context size is stored after a Max or Max 2 turn, and the
 * chat page's banner rule fires at 200k (audit B-01/B-03, spec must-do 9,
 * check 10, ticket T9).
 *
 * A fake finished turn: a job directory under a temp HOME whose stdout.log is
 * framed exactly the way JobManager writes it (4-byte seq, 4-byte length,
 * data) and holds stream-json assistant events with per-call usage, then a
 * `result` event whose usage is summed over the whole turn. The exit hook is
 * fed that turn; the stored `contextTokens` must be the LAST model call's
 * input + cache read + cache creation, never the result's turn total.
 *
 * HOME is set before any module under test is imported, because `JOBS_ROOT`
 * (manager.ts) is computed at module load.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';

import { tempDir } from '@/lib/server/testing/tempDir';

const home = tempDir('context-ceiling-');
process.env.HOME = home;

type StartTurnModule = typeof import('./startTurn.js');
type ChatStoreModule = typeof import('./chatStore.js');
type CeilingModule = typeof import('../../contextCeiling.js');
type TurnExitEvent = import('./startTurn.js').TurnExitEvent;
type TierId = import('@/types/chat').TierId;
type JobRecord = import('@/types/jobs').JobRecord;

let st: StartTurnModule;
let store: ChatStoreModule;
let ceiling: CeilingModule;

before(async () => {
  st = await import('./startTurn.js');
  store = await import('./chatStore.js');
  ceiling = await import('../../contextCeiling.js');
});

/* ---- Fixtures ------------------------------------------------------------ */

let seq = 0;
function frame(event: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(event) + '\n');
  const head = Buffer.alloc(8);
  head.writeUInt32BE(++seq, 0);
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

interface Usage {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
}

function usage(input: number, read: number, creation: number): Usage {
  return {
    input_tokens: input,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: creation,
    output_tokens: 40,
  };
}

function assistant(id: string, u: Usage, extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: 'sess',
    message: { id, role: 'assistant', content: [{ type: 'text', text: 'hi' }], usage: u },
    ...extra,
  };
}

let jobCounter = 0;
/** Writes a finished chat-turn job the way the manager stores it; returns its record. */
function fakeTurn(events: unknown[]): JobRecord {
  const id = `job_ctx_${++jobCounter}`;
  const dir = path.join(home, '.sam', 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const record: JobRecord = {
    id,
    command: 'sam-agent (Max) — hello',
    status: 'exited',
    exitCode: 0,
    createdAt: now,
    startedAt: now,
    endedAt: now,
    outputBytes: 0,
    lastSeq: events.length,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(record));
  fs.writeFileSync(path.join(dir, 'stdout.log'), Buffer.concat(events.map(frame)));
  return record;
}

let chatCounter = 0;
function newChat(tier: TierId = 'max'): string {
  const n = String(++chatCounter).padStart(12, '0');
  const id = `aaaaaaaa-bbbb-4ccc-8ddd-${n}`;
  store.createChat({ id, tier, account: tier === 'max2' ? 'max2' : 'main', firstMessage: 'hello' });
  return id;
}

function exitEvent(chatId: string, record: JobRecord, tier: TierId, internal = false): TurnExitEvent {
  return { chatId, jobId: record.id, exitCode: 0, tier, internal, record, chat: store.getChat(chatId) };
}

/** A turn of three model calls whose last call sums to `last`, plus a result
 *  event summing the whole turn (far larger than any one call). */
function turnEndingAt(last: number): unknown[] {
  return [
    { type: 'system', subtype: 'init', session_id: 'sess', model: 'claude-opus' },
    assistant('msg_1', usage(2, 90_000, 5_000)),
    assistant('msg_2', usage(2, 95_000, 4_000)),
    // One model call can emit several assistant events with the same id.
    assistant('msg_3', usage(2, last - 1_002, 1_000)),
    assistant('msg_3', usage(2, last - 1_002, 1_000)),
    { type: 'result', session_id: 'sess', usage: usage(6, 400_000, 20_000) },
  ];
}

/* ---- Tests --------------------------------------------------------------- */

test('contextOf sums input, cache read and cache creation', () => {
  assert.equal(ceiling.contextOf(usage(2, 140_000, 9_998)), 150_000);
  assert.equal(ceiling.contextOf({}), 0);
  assert.equal(ceiling.CONTEXT_BANNER_TOKENS, 200_000);
  assert.equal(ceiling.CONTEXT_HANDOFF_TOKENS, 400_000);
});

test('a 150k Max turn stores 150k and the banner stays hidden', async () => {
  const chatId = newChat('max');
  const record = fakeTurn(turnEndingAt(150_000));
  await st.recordTurnContext(exitEvent(chatId, record, 'max'));
  const chat = store.getChat(chatId);
  assert.equal(chat?.contextTokens, 150_000);
  assert.ok(chat?.contextAt && !Number.isNaN(Date.parse(chat.contextAt)), 'contextAt is an ISO time');
  assert.equal(ceiling.showContextBanner(chat ?? {}), false);
});

test('a 210k Max 2 turn stores 210k and the banner shows', async () => {
  const chatId = newChat('max2');
  const record = fakeTurn(turnEndingAt(210_000));
  await st.recordTurnContext(exitEvent(chatId, record, 'max2'));
  const chat = store.getChat(chatId);
  assert.equal(chat?.contextTokens, 210_000);
  assert.equal(ceiling.showContextBanner(chat ?? {}), true);
  // A handed-off chat never shows it: the conversation already moved on.
  assert.equal(ceiling.showContextBanner({ ...chat, handedOffTo: 'other' }), false);
});

test('the summary the chat list polls carries contextTokens', async () => {
  const chatId = newChat('max');
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(turnEndingAt(230_000)), 'max'));
  const { listChatSummaries } = await import('./chatActions.js');
  const row = listChatSummaries().find((c) => c.id === chatId);
  assert.equal(row?.contextTokens, 230_000);
});

test('the next turn overwrites the stored size with its own last call', async () => {
  const chatId = newChat('max');
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(turnEndingAt(210_000)), 'max'));
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(turnEndingAt(120_000)), 'max'));
  assert.equal(store.getChat(chatId)?.contextTokens, 120_000);
});

test('a subagent call and a zero-usage API error after the last real call are ignored', async () => {
  const chatId = newChat('max');
  const events = [
    assistant('msg_1', usage(2, 180_000, 2_000)),
    // A Task subagent's own call: its context is not the chat's.
    assistant('msg_sub', usage(5, 30_000, 1_000), { parent_tool_use_id: 'toolu_1' }),
    // The CLI's synthetic API-error message carries all-zero usage.
    assistant('err-uuid', usage(0, 0, 0), { error: 'rate_limit', is_api_error_message: true }),
    { type: 'result', session_id: 'sess', usage: usage(7, 210_000, 3_000) },
  ];
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(events), 'max'));
  assert.equal(store.getChat(chatId)?.contextTokens, 182_002);
});

test('Gemini, Pro and Fast turns, and internal turns, store nothing', async () => {
  for (const tier of ['gemini', 'pro', 'fast'] as const) {
    const chatId = newChat(tier);
    await st.recordTurnContext(exitEvent(chatId, fakeTurn(turnEndingAt(250_000)), tier));
    assert.equal(store.getChat(chatId)?.contextTokens, undefined, `${tier} stored a context size`);
  }
  const chatId = newChat('max');
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(turnEndingAt(250_000)), 'max', true));
  assert.equal(store.getChat(chatId)?.contextTokens, undefined, 'an internal turn stored a context size');
});

test('a turn with no usable output keeps the last stored size and never throws', async () => {
  const chatId = newChat('max');
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(turnEndingAt(205_000)), 'max'));
  // No model call at all (the turn died before one), then garbage output.
  await st.recordTurnContext(exitEvent(chatId, fakeTurn([{ type: 'result', usage: usage(1, 2, 3) }]), 'max'));
  await st.recordTurnContext(exitEvent(chatId, fakeTurn(['not json {']), 'max'));
  // A job with no output directory at all.
  const missing: JobRecord = { ...fakeTurn([]), id: 'job_ctx_missing' };
  await assert.doesNotReject(st.recordTurnContext(exitEvent(chatId, missing, 'max')));
  assert.equal(store.getChat(chatId)?.contextTokens, 205_000);
  // A chat that vanished from the store.
  await assert.doesNotReject(
    st.recordTurnContext(exitEvent('aaaaaaaa-bbbb-4ccc-8ddd-999999999999', fakeTurn(turnEndingAt(1)), 'max')),
  );
});

test('the context hook is registered on onTurnExit, and the usage hook stays last', () => {
  const at = st.onTurnExit.indexOf(st.recordTurnContext);
  assert.ok(at >= 0, 'recordTurnContext is not an exit hook');
  assert.ok(at < st.onTurnExit.length - 1, 'the context hook must not be the last exit hook');
});
