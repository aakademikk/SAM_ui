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

// 2026-10-13 (work area): spokenText (voice, Replay and the push body) never carries a comment.
const MARKER = '<!-- work: 02 - Atwood Systems/x/Plan Diagram.md -->';
function assertClean(spoken: string, keeps: string[]) {
  for (const bad of ['<!--', 'work', '/', 'Plan Diagram', '.md']) {
    assert.ok(!spoken.includes(bad), `spoken text holds ${JSON.stringify(bad)}: ${spoken}`);
  }
  for (const k of keeps) assert.ok(spoken.includes(k), `spoken text lost ${JSON.stringify(k)}: ${spoken}`);
}

test('spokenText drops a one-line marker before the more line', () => {
  const s = spokenText(turn([{ kind: 'text', text: `Here is the plan.\n${MARKER}\nIt is ready.\n<!-- more -->\nLong detail.` }]));
  assertClean(s, ['Here is the plan.', 'It is ready.']);
  assert.equal(s, 'Here is the plan.\nIt is ready.');
});

test('spokenText drops a several-line comment', () => {
  const s = spokenText(turn([{ kind: 'text', text: 'First.\n<!--\nwork: 02 - Atwood Systems/x/Plan Diagram.md\n-->\nSecond.' }]));
  assertClean(s, ['First.', 'Second.']);
  assert.equal(s, 'First.\nSecond.');
});

test('spokenText drops a marker after the more line', () => {
  const s = spokenText(turn([{ kind: 'text', text: `Short.\n<!-- more -->\nLong.\n${MARKER}` }]));
  assertClean(s, ['Short.']);
  assert.equal(s, 'Short.');
});

test('spokenText drops an unterminated comment and what follows', () => {
  const s = spokenText(turn([{ kind: 'text', text: 'Real.\n<!-- work: 02 - Atwood Systems/x/Plan Diagram.md\nHidden.' }]));
  assertClean(s, ['Real.']);
  assert.equal(s, 'Real.');
});

test('spokenText slice(0, 100) holds no marker when the marker is in the first 100 characters', () => {
  const s = spokenText(turn([{ kind: 'text', text: `Done.\n${MARKER}\n` + 'The rest of the answer is a long run of plain words. '.repeat(5) }])).slice(0, 100);
  assert.ok(!s.includes('<!--') && !s.includes('work:') && !s.includes('Plan Diagram'), s);
  assert.ok(s.startsWith('Done.\nThe rest'), s);
});
