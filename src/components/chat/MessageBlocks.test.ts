/**
 * SAM — MessageBlocks.tsx's splitBlocks (spec must-do 4; check 4 wiring).
 *
 * Unit-tests only the pure `splitBlocks` — no JSX, runnable under plain
 * `node --test` like every other unit test in this repo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatBlock } from '@/types/chat';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AnswerBlocks, WorkBlocks, splitBlocks } from './MessageBlocks.js';

test('splitBlocks: a side block joins the main-thread answer, not the work panel', () => {
  const tool: ChatBlock = { kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'ok' };
  const side: ChatBlock = { kind: 'side', text: 'a side message' };
  const text: ChatBlock = { kind: 'text', text: 'the final answer' };

  const { answer, work } = splitBlocks([tool, side, text]);

  assert.deepEqual(work, [tool]);
  assert.deepEqual(answer, [side, text]);
});

/*
 * Real shape of a Stop-hook continuation (chat 3a252a4b, 2026-10-11): the answer
 * text, then the hook blocks the end of the turn, so Claude Code continues with
 * a tool call and a short follow-up text.
 */
const hookTurn: ChatBlock[] = [
  { kind: 'thinking', text: 'working it out' },
  { kind: 'text', text: 'Her working book does the fire-safety count in two steps.' },
  { kind: 'tool', id: 't1', name: 'Bash', input: { command: 'sam-waiting add' }, status: 'ok', result: 'w_f1df7a3d' },
  { kind: 'text', text: "I've added the draft to the waiting list as w_f1df7a3d." },
];

test('splitBlocks: a Stop-hook continuation shows the answer then the follow-up in the chat', () => {
  const { answer, work } = splitBlocks(hookTurn);

  assert.deepEqual(answer, [hookTurn[1], hookTurn[3]]);
  assert.deepEqual(work, [hookTurn[0], hookTurn[2]]);
});

test('splitBlocks: a single-segment turn is unchanged', () => {
  const tool: ChatBlock = { kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'ok' };
  const text: ChatBlock = { kind: 'text', text: 'only answer' };

  const { answer, work } = splitBlocks([tool, text]);

  assert.deepEqual(answer, [text]);
  assert.deepEqual(work, [tool]);
});

test('splitBlocks: the long version after a <!-- more --> line goes to View work, the short answer stays (2026-10-12)', () => {
  const blocks: ChatBlock[] = [
    { kind: 'text', text: 'Done, the kitchen build is running.\n<!-- more -->\nThe long version: tickets 25 to 33.' },
  ];
  const { answer, work } = splitBlocks(blocks);
  assert.deepEqual(answer, [{ kind: 'text', text: 'Done, the kitchen build is running.' }]);
  assert.deepEqual(work, [{ kind: 'text', text: 'The long version: tickets 25 to 33.' }]);
});

test('splitBlocks: a reply with no marker is unchanged', () => {
  const blocks: ChatBlock[] = [{ kind: 'text', text: 'Short and done.' }];
  assert.deepEqual(splitBlocks(blocks), { answer: blocks, work: [], items: [] });
});

test('splitBlocks: markers before and after <!-- more --> become items and never reach the answer or the work text', () => {
  const blocks: ChatBlock[] = [
    { kind: 'text', text: 'Short answer.\n<!-- work: Projects/Plan.md -->\n<!-- more -->\nLong version.\n<!-- work: https://example.com/x -->' },
    { kind: 'text', text: '<!-- work: only-a-marker.png -->' },
  ];
  const { answer, work, items } = splitBlocks(blocks);
  assert.deepEqual(items, [
    { target: 'Projects/Plan.md', isWeb: false },
    { target: 'https://example.com/x', isWeb: true },
    { target: 'only-a-marker.png', isWeb: false },
  ]);
  assert.equal(answer.length, 1);
  assert.equal(work.length, 1);
  for (const b of [...answer, ...work]) {
    const t = b.kind === 'text' ? b.text : '';
    assert.equal(t.includes('<!--'), false);
    assert.equal(t.includes('work:'), false);
  }
});

test('WorkBlocks formats the long version (heading, table, no script); AnswerBlocks stays plain text', () => {
  const text = '## Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>';
  const blocks: ChatBlock[] = [{ kind: 'text', text }];
  const work = renderToStaticMarkup(createElement(WorkBlocks, { blocks }));
  assert.ok(/<h[23]/.test(work), work);
  assert.ok(work.includes('<table'), work);
  assert.ok(!work.includes('<script'), work);
  const answer = renderToStaticMarkup(createElement(AnswerBlocks, { blocks }));
  assert.ok(answer.includes('<p class="text-sm leading-relaxed whitespace-pre-wrap'), answer);
  assert.ok(!answer.includes('<table') && !answer.includes('<h2'), answer);
});
