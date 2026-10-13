import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { decide, withTimeout } from './itemState.js';
import type { ItemMeta } from '@/lib/workItems';

function meta(path: string, size: number | null, over: Partial<ItemMeta> = {}): ItemMeta {
  return { path, available: true, kind: 'document', title: null, size, ...over };
}

test('markdown and html: 2,097,152 bytes loads, one more is too big', () => {
  for (const p of ['a/b.md', 'a/b.html']) {
    assert.equal(decide(meta(p, 2_097_152)).state, 'load');
    const big = decide(meta(p, 2_097_153));
    assert.equal(big.state, 'too-big');
    if (big.state === 'too-big') {
      assert.equal(big.message, 'too big to show here');
      assert.equal(big.path, p);
    }
  }
});

test('pdf: 52,428,800 bytes loads, one more is too big', () => {
  assert.deepEqual(decide(meta('x.pdf', 52_428_800)), { state: 'load', renderer: 'pdf' });
  assert.equal(decide(meta('x.pdf', 52_428_801)).state, 'too-big');
});

test('images and video have no size cap here', () => {
  assert.deepEqual(decide(meta('x.png', 99_000_000)), { state: 'load', renderer: 'image' });
  assert.deepEqual(decide(meta('x.mp4', 99_000_000)), { state: 'load', renderer: 'video' });
});

test('unavailable items give the not available label', () => {
  assert.deepEqual(decide(meta('d/gone.md', null, { available: false })), {
    state: 'unavailable',
    label: 'not available: gone.md',
  });
  assert.equal(decide(meta('d/x.docx', 10)).state, 'unavailable');
});

test('renderer follows the extension', () => {
  assert.deepEqual(decide(meta('a.MD', 1)), { state: 'load', renderer: 'markdown' });
  assert.deepEqual(decide(meta('a.html', 1)), { state: 'load', renderer: 'html' });
});

test('withTimeout rejects at 15,000 ms and not before', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled: string | null = null;
    const p = withTimeout(new Promise<never>(() => {}), 15000).catch((e: Error) => {
      settled = e.message;
    });
    mock.timers.tick(14_999);
    await Promise.resolve();
    assert.equal(settled, null);
    mock.timers.tick(1);
    await p;
    assert.equal(settled, 'timeout');
  } finally {
    mock.timers.reset();
  }
});

test('withTimeout passes a resolved value through', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 15000), 7);
});
