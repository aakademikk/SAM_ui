import test from 'node:test';
import assert from 'node:assert/strict';

import { entryLabel, relativeTime, type RecentListEntry } from './recentView.js';

const now = new Date('2026-10-13T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

const base: RecentListEntry = {
  path: '02 - Atwood Systems/Proj/a.md',
  chatId: 'c1',
  messageId: 'j1',
  at: ago(5 * 60_000),
  title: 'Plan',
  missing: false,
  chatTitle: 'My chat',
  project: '02 - Atwood Systems/Proj',
};

test('relative time words', () => {
  assert.equal(relativeTime(ago(10_000), now), 'just now');
  assert.equal(relativeTime(ago(60_000), now), '1 minute ago');
  assert.equal(relativeTime(ago(5 * 60_000), now), '5 minutes ago');
  assert.equal(relativeTime(ago(3_600_000), now), '1 hour ago');
  assert.equal(relativeTime(ago(3 * 3_600_000), now), '3 hours ago');
  assert.equal(relativeTime(ago(30 * 3_600_000), now), 'yesterday');
  assert.equal(relativeTime(ago(3 * 86_400_000), now), '3 days ago');
  assert.equal(relativeTime(ago(20 * 86_400_000), now), '2 weeks ago');
  assert.equal(relativeTime(ago(60 * 86_400_000), now), '2026-08-14');
  assert.equal(relativeTime('nonsense', now), 'some time ago');
});

test('a present entry is openable with a made label', () => {
  const l = entryLabel(base, now);
  assert.equal(l.made, 'made 5 minutes ago');
  assert.equal(l.title, 'Plan');
  assert.equal(l.chatTitle, 'My chat');
  assert.equal(l.note, null);
  assert.equal(l.openable, true);
});

test('a missing entry says moved or deleted and is not openable', () => {
  const l = entryLabel({ ...base, missing: true }, now);
  assert.equal(l.note, 'moved or deleted');
  assert.equal(l.openable, false);
});
