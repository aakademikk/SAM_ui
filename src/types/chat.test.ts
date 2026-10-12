/**
 * SAM — spokenText reads the same whole text the chat bubble shows.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spokenText, type ChatBlock, type ChatMessage } from './chat.js';

function turn(blocks: ChatBlock[]): ChatMessage {
  return { id: 'a1', role: 'assistant', blocks, done: true };
}

test('spokenText: a Stop-hook continuation speaks the answer then the follow-up', () => {
  const spoken = spokenText(
    turn([
      { kind: 'text', text: 'Her working book does the count in two steps.' },
      { kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'ok', result: 'w_f1df7a3d' },
      { kind: 'text', text: "I've added the draft to the waiting list." },
    ]),
  );

  assert.equal(
    spoken,
    "Her working book does the count in two steps.\n\nI've added the draft to the waiting list.",
  );
});

test('spokenText: a single-segment turn is unchanged', () => {
  assert.equal(spokenText(turn([{ kind: 'text', text: '  just this  ' }])), 'just this');
  assert.equal(spokenText(turn([{ kind: 'tool', id: 't', name: 'Bash', input: {}, status: 'ok' }])), '');
});

test('spokenText reads only the short answer before a <!-- more --> line, in every block (2026-10-12)', () => {
  const msg: ChatMessage = {
    id: 'm', role: 'assistant', done: true,
    blocks: [
      { kind: 'text', text: 'Short answer.\n<!-- more -->\nLong detail nobody should hear.' },
      { kind: 'text', text: 'Follow-up.' },
    ],
  };
  assert.equal(spokenText(msg), 'Short answer.\n\nFollow-up.');
});
