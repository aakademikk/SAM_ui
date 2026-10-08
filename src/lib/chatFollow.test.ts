/**
 * SAM — the chat follows new text only while you are at the bottom (Colin,
 * 2026-10-08: "make it so I can still scroll while SAM is thinking").
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { FOLLOW_SLACK_PX, isNearBottom, newUserMessageId, shouldFollow } from './chatFollow.js';

test('at or near the bottom counts as pinned; scrolled up does not', () => {
  assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 }), true);
  assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1500 - FOLLOW_SLACK_PX, clientHeight: 500 }), true);
  assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1400 - FOLLOW_SLACK_PX, clientHeight: 500 }), false);
  assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 200, clientHeight: 500 }), false);
});

test('a growing reply never pulls you down once you have scrolled up', () => {
  assert.equal(shouldFollow(false, false), false);
  assert.equal(shouldFollow(true, false), true);
});

test('sending a message always brings you back down', () => {
  assert.equal(shouldFollow(false, true), true);
});

test('only a new user message counts as "just sent"', () => {
  const msgs = [{ id: 'a1', role: 'assistant' }, { id: 'u2', role: 'user' }];
  assert.equal(newUserMessageId(msgs, null), 'u2');
  assert.equal(newUserMessageId(msgs, 'u2'), null);
  assert.equal(newUserMessageId([...msgs, { id: 'a3', role: 'assistant' }], 'u2'), null);
  assert.equal(newUserMessageId([], null), null);
});

test('the chat page and the dashboard widget follow only through shouldFollow', () => {
  // The components are React and cannot be mounted here (no jsdom), so pin the
  // wiring: an unconditional scroll-to-bottom on every chunk would come back.
  const root = path.resolve(__dirname, '../../src');
  for (const rel of ['app/(app)/chat/page.tsx', 'components/dashboard/fleet/DashboardChatWidget.tsx']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(src, /shouldFollow\(/, `${rel} must gate auto-scroll with shouldFollow`);
    assert.match(src, /onScroll=\{/, `${rel} must track whether the thread is pinned`);
    assert.doesNotMatch(src, /bottomRef\.current\?\.scrollIntoView/, `${rel} still scrolls unconditionally`);
    assert.doesNotMatch(
      src,
      /useEffect\(\(\) => \{\s*const el = msgsRef\.current;\s*if \(el\) el\.scrollTop = el\.scrollHeight;\s*\}, \[messages, phase\]\);/,
      `${rel} still scrolls unconditionally`,
    );
  }
});
