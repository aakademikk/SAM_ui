import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageItem, VideoItem } from './MediaView.js';
import { MarkdownView } from './MarkdownView.js';

test('an SVG source renders as img, never object, embed or iframe', () => {
  const out = renderToStaticMarkup(createElement(ImageItem, { src: '/api/vault/file?path=a.svg', alt: 'logo' }));
  assert.ok(out.includes('<img'), out);
  assert.ok(out.includes('max-w-full'), out);
  assert.ok(out.includes('h-auto'), out);
  assert.ok(!/<object|<embed|<iframe/i.test(out), out);
  assert.ok(out.includes('min-h-[44px]'), out);
});

test('the video has controls and never autoplays', () => {
  const out = renderToStaticMarkup(createElement(VideoItem, { src: '/api/vault/file?path=a.mp4' }));
  assert.ok(out.includes('<video'), out);
  assert.ok(/\scontrols(=|\s|>)/.test(out), out);
  assert.ok(!/autoplay/i.test(out), out);
  assert.ok(out.includes('preload="metadata"'), out);
  assert.ok(out.includes('playsinline'.replace('inline', 'Inline')) || /playsinline/i.test(out), out);
});

test('markdown vault image and video use the media components; outside images show alt text', () => {
  const md = '![pic](a.png)\n\n![clip](b.mp4)\n\n![away](https://example.com/x.png)';
  const out = renderToStaticMarkup(createElement(MarkdownView, { source: md }));
  assert.ok(out.includes('/api/vault/file?path=a.png'), out);
  assert.ok(out.includes('<video'), out);
  assert.ok(!out.includes('example.com'), out);
  assert.ok(out.includes('away'), out);
});
