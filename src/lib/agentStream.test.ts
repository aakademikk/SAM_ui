/**
 * SAM — agentStream.ts: the `side` block kind and a turn that answers twice
 * (spec must-do 3, 4, 7; checks 4, 7). Plain objects in, plain state out — no
 * DOM, so this runs under `node --test` like any other unit test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentStreamParser } from './agentStream.js';

/** Feed a batch of raw stream-json events as one chunk, each on its own line. */
function feed(parser: AgentStreamParser, events: Record<string, unknown>[]) {
  parser.push(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/** All text streamed so far, across every `kind: 'text'` block, in order. */
function textBlocks(parser: AgentStreamParser): string[] {
  return parser.state.blocks
    .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
    .map((b) => b.text);
}

test('a second result, reached via its own streamed assistant text, keeps both answers', () => {
  const parser = new AgentStreamParser();

  feed(parser, [
    { type: 'system', subtype: 'init', session_id: 'sess1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first answer' }] } },
    { type: 'result', result: 'first answer' },
  ]);
  assert.ok(textBlocks(parser).join('\n').includes('first answer'));

  // Same parser instance, second round of the same turn.
  feed(parser, [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'second answer' }] } },
    { type: 'result', result: 'second answer' },
  ]);

  const joined = textBlocks(parser).join('\n');
  assert.ok(joined.includes('first answer'), 'first answer should still be present');
  assert.ok(joined.includes('second answer'), 'second answer should still be present');
});

test('a second result with NO assistant text before it still gets its own answer', () => {
  // This is the case today's code drops: `!hasText()` is already false once
  // round 1 has produced any text, so round 2's own `result.result` — the
  // only place its answer exists, since nothing streamed as `assistant` text
  // for this round — was silently discarded.
  const parser = new AgentStreamParser();

  feed(parser, [
    { type: 'system', subtype: 'init', session_id: 'sess1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first answer' }] } },
    { type: 'result', result: 'first answer' },
  ]);
  assert.ok(textBlocks(parser).join('\n').includes('first answer'));

  // No assistant event this round — straight to a second result, exactly
  // like a side message answered after the turn's last streamed text.
  feed(parser, [{ type: 'result', result: 'second answer' }]);

  const joined = textBlocks(parser).join('\n');
  assert.ok(joined.includes('first answer'), 'first answer should still be present');
  assert.ok(
    joined.includes('second answer'),
    'second answer must not be dropped just because round 1 already had text',
  );
});

test('a sam_side event pushes its own side block, not folded into surrounding text', () => {
  const parser = new AgentStreamParser();

  feed(parser, [
    { type: 'system', subtype: 'init', session_id: 'sess1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
  ]);

  feed(parser, [
    { type: 'sam_side', message: { content: [{ type: 'text', text: 'side!' }] } },
  ]);

  assert.deepEqual(
    parser.state.blocks[parser.state.blocks.length - 1],
    { kind: 'side', text: 'side!' },
  );

  // A second side message right after gets its own box too, not merged.
  feed(parser, [
    { type: 'sam_side', message: { content: [{ type: 'text', text: 'side again!' }] } },
  ]);

  const sideBlocks = parser.state.blocks.filter((b) => b.kind === 'side');
  assert.deepEqual(sideBlocks, [
    { kind: 'side', text: 'side!' },
    { kind: 'side', text: 'side again!' },
  ]);
});
