/**
 * SAM — card meta loading (fix 2026-10-13). On the A16 a work card sat on its
 * bare file name until a reload: the chat page's meta fetch had no timeout and
 * no retry, so one stalled request left the card unopenable for good.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { loadCardMeta } from './cardMeta.js';
import type { ItemMeta } from './workItems.js';

const META: ItemMeta = { path: 'a.md', available: true, kind: 'document', title: 'A', size: 10 };

/** A fetch that never answers until aborted, like the stalled request seen live. */
function hangingFetch(calls: { n: number }) {
  return (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      calls.n += 1;
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
}

function okFetch(calls: { n: number }) {
  return async () => {
    calls.n += 1;
    return new Response(JSON.stringify({ items: [META] }), { status: 200 });
  };
}

test('loadCardMeta: a stalled request times out, retries twice, then marks the item unavailable', async () => {
  const calls = { n: 0 };
  const got = await loadCardMeta(['a.md'], { fetchImpl: hangingFetch(calls), timeoutMs: 20, retryDelayMs: 0 });
  assert.equal(calls.n, 3);
  assert.deepEqual(got, [{ path: 'a.md', available: false, kind: null, title: null, size: null }]);
});

test('loadCardMeta: a stall followed by a good answer gives the real meta', async () => {
  const calls = { n: 0 };
  const hang = hangingFetch(calls);
  const ok = okFetch(calls);
  const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => (calls.n === 0 ? hang(url, init) : ok());
  const got = await loadCardMeta(['a.md'], { fetchImpl, timeoutMs: 20, retryDelayMs: 0 });
  assert.equal(calls.n, 2);
  assert.deepEqual(got, [META]);
});

test('loadCardMeta: a 500 is retried; a 401 is not (it will not change by retrying)', async () => {
  const calls = { n: 0 };
  const five = async () => {
    calls.n += 1;
    return new Response('x', { status: 500 });
  };
  await loadCardMeta(['a.md'], { fetchImpl: five, timeoutMs: 20, retryDelayMs: 0 });
  assert.equal(calls.n, 3);

  calls.n = 0;
  const four = async () => {
    calls.n += 1;
    return new Response('x', { status: 401 });
  };
  const got = await loadCardMeta(['a.md'], { fetchImpl: four, timeoutMs: 20, retryDelayMs: 0 });
  assert.equal(calls.n, 1);
  assert.equal(got[0].available, false);
});

test('loadCardMeta: one request carries every path, and a missing answer is unavailable', async () => {
  let seen = '';
  const fetchImpl = async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ items: [META] }), { status: 200 });
  };
  const got = await loadCardMeta(['a.md', 'b c.png'], { fetchImpl, timeoutMs: 20, retryDelayMs: 0 });
  assert.equal(seen, '/api/vault/meta?path=a.md&path=b%20c.png');
  assert.deepEqual(got[0], META);
  assert.equal(got[1].available, false);
  assert.equal(got[1].path, 'b c.png');
});

test('chat page loads card meta through loadCardMeta, not a bare fetch', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/(app)/chat/page.tsx'), 'utf-8');
  assert.match(src, /loadCardMeta\(/);
  assert.doesNotMatch(src, /fetch\(`\/api\/vault\/meta/);
});
