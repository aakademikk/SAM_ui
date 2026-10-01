/**
 * SAM — chatStore.ts: create, list order, archive/restore, delete, and
 * filterByTitle (title only, never message text).
 *
 * Every test points HOME at a fresh temp dir and calls
 * __resetChatStoreForTests() before touching the store, so tests never
 * share state with each other or with Colin's real ~/.sam/samui-chats.json.
 * HOME is reassigned per test (not just once at the top of the file), which
 * is safe only because chatStore.ts resolves its path from os.homedir() on
 * every load rather than caching it at module import time.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

let chatStore: typeof import('./chatStore.js');
const ready = (async () => {
  chatStore = await import('./chatStore.js');
})();

/** Point HOME at a fresh temp dir and drop the cached store, so this test
 *  starts from an empty, private ~/.sam/samui-chats.json. */
function freshHome(): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatstore-home-'));
  process.env.HOME = tmp;
  chatStore.__resetChatStoreForTests();
}

test('createChat persists a record; getChat reads it back', async () => {
  await ready;
  freshHome();

  const record = chatStore.createChat({
    id: 'chat-1',
    tier: 'max',
    account: 'main',
    firstMessage: 'Hello there',
    title: 'Hello there',
  });
  assert.equal(record.id, 'chat-1');
  assert.equal(record.deleted, false);
  assert.equal(record.archived, false);
  assert.equal(record.turns, 0);
  assert.equal(record.runningJobId, null);

  const fetched = chatStore.getChat('chat-1');
  assert.ok(fetched);
  assert.equal(fetched?.title, 'Hello there');

  // Genuinely on disk, not just in the in-memory cache: reset and re-read.
  chatStore.__resetChatStoreForTests();
  const reloaded = chatStore.getChat('chat-1');
  assert.ok(reloaded);
  assert.equal(reloaded?.firstMessage, 'Hello there');
});

test('listChats returns the main list newest lastActiveAt first', async () => {
  await ready;
  freshHome();

  chatStore.createChat({
    id: 'a',
    tier: 'max',
    account: 'main',
    firstMessage: 'first',
    title: 'A',
    lastActiveAt: '2026-09-30T10:00:00.000Z',
  });
  chatStore.createChat({
    id: 'b',
    tier: 'max',
    account: 'main',
    firstMessage: 'second',
    title: 'B',
    lastActiveAt: '2026-09-30T12:00:00.000Z',
  });
  chatStore.createChat({
    id: 'c',
    tier: 'max',
    account: 'main',
    firstMessage: 'third',
    title: 'C',
    lastActiveAt: '2026-09-30T11:00:00.000Z',
  });

  const list = chatStore.listChats();
  assert.deepEqual(
    list.map((c) => c.id),
    ['b', 'c', 'a'],
  );
});

test('archiveChat hides a chat from the main list; restoreChat returns it', async () => {
  await ready;
  freshHome();

  chatStore.createChat({ id: 'x', tier: 'max', account: 'main', firstMessage: 'm', title: 'X' });

  assert.equal(chatStore.listChats().length, 1);
  assert.equal(chatStore.listChats({ archived: true }).length, 0);

  chatStore.archiveChat('x');
  assert.equal(chatStore.listChats().length, 0);
  const archivedList = chatStore.listChats({ archived: true });
  assert.equal(archivedList.length, 1);
  assert.equal(archivedList[0].id, 'x');
  // getChat still finds it — archiving is not deleting.
  assert.ok(chatStore.getChat('x'));

  chatStore.restoreChat('x');
  assert.equal(chatStore.listChats().length, 1);
  assert.equal(chatStore.listChats({ archived: true }).length, 0);
});

test('deleteChat removes a chat from both lists and from getChat', async () => {
  await ready;
  freshHome();

  chatStore.createChat({ id: 'main-chat', tier: 'max', account: 'main', firstMessage: 'm', title: 'Main one' });
  chatStore.createChat({
    id: 'archived-chat',
    tier: 'max',
    account: 'main',
    firstMessage: 'm',
    title: 'Archived one',
    archived: true,
  });

  chatStore.deleteChat('main-chat');
  chatStore.deleteChat('archived-chat');

  assert.equal(chatStore.listChats().length, 0);
  assert.equal(chatStore.listChats({ archived: true }).length, 0);
  assert.equal(chatStore.getChat('main-chat'), null);
  assert.equal(chatStore.getChat('archived-chat'), null);
});

test('filterByTitle matches part of a title, in both the main list and Archived, ' +
  'and never matches on firstMessage', async () => {
  await ready;
  freshHome();

  chatStore.createChat({
    id: 'kitchen-main',
    tier: 'max',
    account: 'main',
    firstMessage: 'Batch 4 update',
    title: 'Kitchen v3 status',
  });
  chatStore.createChat({
    id: 'kitchen-archived',
    tier: 'max',
    account: 'main',
    firstMessage: 'Older batch notes',
    title: 'Kitchen status',
    archived: true,
  });
  // Its title has nothing to do with "Parkfords" — that word only appears in
  // firstMessage, which filterByTitle must never search.
  chatStore.createChat({
    id: 'kitchen-parkfords',
    tier: 'max',
    account: 'main',
    firstMessage: 'Call about the Parkfords job before Friday',
    title: 'Kitchen status',
  });

  const mainMatches = chatStore.listChats({ q: 'kitchen' });
  assert.deepEqual(
    mainMatches.map((c) => c.id).sort(),
    ['kitchen-main', 'kitchen-parkfords'],
  );

  const archivedMatches = chatStore.listChats({ archived: true, q: 'kitchen' });
  assert.deepEqual(
    archivedMatches.map((c) => c.id),
    ['kitchen-archived'],
  );

  // Case-insensitive, substring, title only.
  assert.deepEqual(
    chatStore.listChats({ q: 'STATUS' }).map((c) => c.id).sort(),
    ['kitchen-main', 'kitchen-parkfords'],
  );

  // The whole point of this fixture: searching a word that only appears in
  // firstMessage returns nothing, in either list.
  assert.equal(chatStore.listChats({ q: 'Parkfords' }).length, 0);
  assert.equal(chatStore.listChats({ archived: true, q: 'Parkfords' }).length, 0);

  // The pure function directly, on a plain array, with no store involved.
  const pureResult = chatStore.filterByTitle(
    [
      { title: 'Kitchen status' },
      { title: 'Bathroom quote' },
    ],
    'kitchen',
  );
  assert.deepEqual(pureResult, [{ title: 'Kitchen status' }]);
});

test('setTitle, setRunningJob, touchChat and markHandedOff update the record in place', async () => {
  await ready;
  freshHome();

  chatStore.createChat({ id: 'y', tier: 'unknown', account: 'main', firstMessage: 'm', title: 'Y' });
  chatStore.createChat({ id: 'z', tier: 'max2', account: 'max2', firstMessage: 'm', title: 'Z' });

  chatStore.setTitle('y', 'Haiku-picked title', 'haiku');
  const afterTitle = chatStore.getChat('y');
  assert.equal(afterTitle?.title, 'Haiku-picked title');
  assert.equal(afterTitle?.titleSource, 'haiku');

  chatStore.setRunningJob('y', 'job-123');
  assert.equal(chatStore.getChat('y')?.runningJobId, 'job-123');
  chatStore.setRunningJob('y', null);
  assert.equal(chatStore.getChat('y')?.runningJobId, null);

  const before = chatStore.getChat('y');
  chatStore.touchChat('y', { incrementTurns: true });
  const after = chatStore.getChat('y');
  assert.equal(after?.turns, (before?.turns ?? 0) + 1);
  assert.ok(after && after.lastActiveAt >= (before?.lastActiveAt ?? ''));

  chatStore.markHandedOff('y', 'z');
  assert.equal(chatStore.getChat('y')?.handedOffTo, 'z');
  assert.equal(chatStore.getChat('z')?.handedOffFrom, 'y');

  chatStore.recordTitleTryFailure('y');
  assert.equal(chatStore.getChat('y')?.titleTries, 1);

  chatStore.setHandoffError('y', 'seat at its limit');
  assert.equal(chatStore.getChat('y')?.handoffError, 'seat at its limit');
});

test('getImportedAt / setImportedAt round-trip at the store level', async () => {
  await ready;
  freshHome();

  assert.equal(chatStore.getImportedAt(), undefined);
  chatStore.setImportedAt('2026-09-30T00:00:00.000Z');
  assert.equal(chatStore.getImportedAt(), '2026-09-30T00:00:00.000Z');

  // Persisted, not just cached.
  chatStore.__resetChatStoreForTests();
  assert.equal(chatStore.getImportedAt(), '2026-09-30T00:00:00.000Z');
});
