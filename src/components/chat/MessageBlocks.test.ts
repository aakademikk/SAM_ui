/**
 * SAM — MessageBlocks.tsx's splitBlocks (spec must-do 4; check 4 wiring).
 *
 * Unit-tests only the pure `splitBlocks` — no JSX, runnable under plain
 * `node --test` like every other unit test in this repo.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatBlock } from '@/types/chat';

import { splitBlocks } from './MessageBlocks.js';

test('splitBlocks: a side block joins the main-thread answer, not the work panel', () => {
  const tool: ChatBlock = { kind: 'tool', id: 't1', name: 'Bash', input: {}, status: 'ok' };
  const side: ChatBlock = { kind: 'side', text: 'a side message' };
  const text: ChatBlock = { kind: 'text', text: 'the final answer' };

  const { answer, work } = splitBlocks([tool, side, text]);

  assert.deepEqual(work, [tool]);
  assert.deepEqual(answer, [side, text]);
});
