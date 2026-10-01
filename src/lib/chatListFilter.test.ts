/**
 * SAM — chatListFilter.ts: the client-side mirror of the server's
 * filterByTitle (chatStore.ts). No React, no DOM — a plain array in, a plain
 * array out — so this runs under `node --test` like any other unit test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterChatTitles } from './chatListFilter.js';

interface Fixture {
  id: string;
  title: string;
  /** Stands in for a chat's first message — filterChatTitles must never
   *  search it, only `title`. */
  firstMessage: string;
}

function fixtures(): Fixture[] {
  return [
    { id: 'kitchen-main', title: 'Kitchen v3 status', firstMessage: 'Batch 4 update' },
    { id: 'kitchen-archived', title: 'Kitchen status', firstMessage: 'Older batch notes' },
    { id: 'bathroom', title: 'Bathroom quote', firstMessage: 'Call about the Parkfords job before Friday' },
  ];
}

test('filterChatTitles matches part of a title, case-insensitively, in the main list', () => {
  const matches = filterChatTitles(fixtures(), 'kitchen');
  assert.deepEqual(
    matches.map((c) => c.id),
    ['kitchen-main', 'kitchen-archived'],
  );

  // Case-insensitive, substring.
  assert.deepEqual(
    filterChatTitles(fixtures(), 'STATUS').map((c) => c.id),
    ['kitchen-main', 'kitchen-archived'],
  );
});

test('filterChatTitles matches part of a title the same way in an Archived-view list', () => {
  const archived = [
    { id: 'kitchen-archived', title: 'Kitchen status', firstMessage: 'Older batch notes' },
    { id: 'bathroom-archived', title: 'Bathroom quote', firstMessage: 'Nothing kitchen-related' },
  ];
  assert.deepEqual(
    filterChatTitles(archived, 'kitchen').map((c) => c.id),
    ['kitchen-archived'],
  );
});

test('a word that appears only inside a message (never the title) matches nothing', () => {
  // "Parkfords" is in bathroom's firstMessage only — filterChatTitles must
  // never search that field.
  assert.equal(filterChatTitles(fixtures(), 'Parkfords').length, 0);
  assert.equal(filterChatTitles(fixtures(), 'parkfords').length, 0);
});
