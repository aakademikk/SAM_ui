import test from 'node:test';
import assert from 'node:assert/strict';
import { safePdfLinks } from './pdfLinks.js';

const rect = [10, 20, 110, 40];

test('keeps http and https link annotations', () => {
  const out = safePdfLinks([
    { subtype: 'Link', url: 'https://example.com/a', rect },
    { subtype: 'Link', url: 'http://example.org', rect },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://example.com/a');
  assert.deepEqual(out[0].rect, rect);
});

test('drops javascript, other schemes, and unsafeUrl-only links', () => {
  const out = safePdfLinks([
    { subtype: 'Link', url: 'javascript:alert(1)', rect },
    { subtype: 'Link', unsafeUrl: 'javascript:alert(1)', rect },
    { subtype: 'Link', url: 'file:///etc/passwd', rect },
    { subtype: 'Link', url: 'data:text/html,hi', rect },
    { subtype: 'Link', url: 'ftp://example.com', rect },
    { subtype: 'Link', url: 'not a url', rect },
  ]);
  assert.deepEqual(out, []);
});

test('drops named, launch, submit and other action annotations', () => {
  const out = safePdfLinks([
    { subtype: 'Link', action: 'NextPage', rect },
    { subtype: 'Link', action: 'Launch', rect },
    { subtype: 'Link', dest: [1, 'XYZ'], rect },
    { subtype: 'Widget', url: 'https://example.com', rect },
    { subtype: 'Text', url: 'https://example.com', rect },
    { subtype: 'Link', url: 42, rect },
  ]);
  assert.deepEqual(out, []);
});

test('drops links with a bad rect and tolerates empty input', () => {
  assert.deepEqual(safePdfLinks([{ subtype: 'Link', url: 'https://example.com' }]), []);
  assert.deepEqual(safePdfLinks([{ subtype: 'Link', url: 'https://example.com', rect: [1, 2, NaN, 4] }]), []);
  assert.deepEqual(safePdfLinks(null), []);
  assert.deepEqual(safePdfLinks([]), []);
});
