/**
 * SAM — DashboardChatWidget.test: the widget's most-recent-chat pick and its
 * picker filter (visual upgrade T14, Must 3e). Pure: plain fixtures in, no
 * fetch, no live chat store, no turn started. HOME is still pointed at a
 * scratch dir before the module loads, as every test here does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

import type { ChatSummary } from '../../../types/chat.js';

process.env.HOME = tempDir('dashchat-home-');

type Helpers = typeof import('./dashboardChat.js');
let pickMostRecentChat: Helpers['pickMostRecentChat'];
let pickerChats: Helpers['pickerChats'];
let sendTierFor: Helpers['sendTierFor'];
let messageLine: Helpers['messageLine'];
let filterChatTitles: typeof import('../../../lib/chatListFilter.js').filterChatTitles;

const ready = (async () => {
  ({ pickMostRecentChat, pickerChats, sendTierFor, messageLine } = await import('./dashboardChat.js'));
  ({ filterChatTitles } = await import('../../../lib/chatListFilter.js'));
})();

function chat(id: string, title: string, lastActiveAt: string, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    title,
    tier: 'fast',
    account: 'main',
    createdAt: '2026-09-01T09:00:00.000Z',
    lastActiveAt,
    turns: 3,
    archived: false,
    imported: false,
    running: false,
    ...extra,
  };
}

function fixtures(): ChatSummary[] {
  // Deliberately not in lastActiveAt order: the pick must not trust list order.
  return [
    chat('older', 'Kitchen v3 status', '2026-10-01T08:00:00.000Z'),
    chat('newest', 'Bathroom quote', '2026-10-02T11:30:00.000Z'),
    chat('middle', 'kitchen fitters list', '2026-10-02T09:15:00.000Z', { running: true }),
  ];
}

test('pickMostRecentChat returns the most recently active chat, whatever the list order', async () => {
  await ready;
  assert.equal(pickMostRecentChat(fixtures()), 'newest');
  assert.equal(pickMostRecentChat([...fixtures()].reverse()), 'newest');
});

test('pickMostRecentChat agrees with the server list order (lastActiveAt, newest first)', async () => {
  await ready;
  const serverOrder = [...fixtures()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  assert.equal(pickMostRecentChat(fixtures()), serverOrder[0].id);
});

test('pickMostRecentChat keeps the first of two chats active at the same moment', async () => {
  await ready;
  const tie = [chat('a', 'A', '2026-10-02T10:00:00.000Z'), chat('b', 'B', '2026-10-02T10:00:00.000Z')];
  assert.equal(pickMostRecentChat(tie), 'a');
});

test('pickMostRecentChat returns null for no chats', async () => {
  await ready;
  assert.equal(pickMostRecentChat([]), null);
});

test('pickerChats filters by title exactly as filterChatTitles does', async () => {
  await ready;
  const list = fixtures();
  for (const q of ['kitchen', 'KITCHEN', 'quote', 'v3', 'nothing like this']) {
    assert.deepEqual(pickerChats(list, q), filterChatTitles(list, q));
  }
  assert.deepEqual(pickerChats(list, 'kitchen').map((c) => c.id), ['older', 'middle']);
});

test('pickerChats shows the whole list for an empty or blank query, and trims the query', async () => {
  await ready;
  const list = fixtures();
  assert.deepEqual(pickerChats(list, ''), list);
  assert.deepEqual(pickerChats(list, '   '), list);
  assert.deepEqual(pickerChats(list, '  bathroom '), filterChatTitles(list, 'bathroom'));
});

test('sendTierFor uses the chat\'s own tier, and max for an imported chat with none', async () => {
  await ready;
  assert.equal(sendTierFor('pro'), 'pro');
  assert.equal(sendTierFor('unknown'), 'max');
  assert.equal(sendTierFor(null), 'max');
});

test('messageLine shows the user text, SAM\'s last text block, or its error', async () => {
  await ready;
  assert.equal(messageLine({ id: 'u', role: 'user', done: true, blocks: [{ kind: 'text', text: 'hi there' }] }), 'hi there');
  assert.equal(
    messageLine({
      id: 'a',
      role: 'assistant',
      done: true,
      blocks: [
        { kind: 'text', text: 'Looking now.' },
        { kind: 'tool', id: 't1', name: 'Read', input: {}, status: 'ok' },
        { kind: 'text', text: 'All done.' },
      ],
    }),
    'All done.',
  );
  assert.equal(
    messageLine({ id: 'e', role: 'assistant', done: true, blocks: [{ kind: 'error', text: 'Lost connection to this run.' }] }),
    'Lost connection to this run.',
  );
});
