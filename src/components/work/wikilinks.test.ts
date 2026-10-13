import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from './MarkdownView.js';
import { linkTarget } from './wikilinks.js';

const ITEM = 'Notes/Item.md';
function render(source: string): string {
  return renderToStaticMarkup(createElement(MarkdownView, { source, itemPath: ITEM, onOpenItem: () => {} }));
}

test('wikilink and relative link give vault targets', () => {
  assert.deepEqual(linkTarget('Sample%20Note.md', ITEM), { kind: 'vault', path: 'Sample Note.md' });
  assert.deepEqual(linkTarget('./Sample%20Note.md', ITEM), { kind: 'vault', path: 'Sample Note.md' });
  assert.deepEqual(linkTarget('https://example.com/a', ITEM), { kind: 'web', href: 'https://example.com/a' });
});

test('unsafe or disallowed targets are plain', () => {
  const bad = ['../x.md', '.git/config', 'a/.obsidian/app.json', 'javascript:alert(1)', 'x.txt', 'x', '%2e%2e/x.md', 'a\\b.md', '/etc/x.md'];
  for (const raw of bad) {
    assert.deepEqual(linkTarget(raw, ITEM), { kind: 'plain' }, raw);
  }
});

test('refused links render as text with no button and no link', () => {
  const out = render('[x](../x.md) and [[.git/config]] and [y](javascript:alert(1))');
  assert.ok(!out.includes('<a'), out);
  assert.ok(!out.includes('<button'), out);
  assert.ok(out.includes('x') && out.includes('.git/config'), out);
});

test('a vault link is plain text until meta says it is available', () => {
  const out = render('[[Sample Note]] and [sample](./Sample%20Note.md)');
  assert.ok(out.includes('Sample Note') && out.includes('sample'), out);
  assert.ok(!out.includes('<a'), out);
});

test('![[pic.png]] renders an img whose src holds from=', () => {
  const out = render('![[pic.png]]');
  const m = /<img[^>]*src="([^"]*)"/.exec(out);
  assert.ok(m, out);
  assert.ok(m[1].includes('/api/vault/file?path=pic.png'), m[1]);
  assert.ok(m[1].includes('from='), m[1]);
});

test('outside images show as alt text, and code is left alone', () => {
  const out = render('![remote pic](https://example.com/a.png)\n\n`[[not a link]]`');
  assert.ok(!out.includes('<img'), out);
  assert.ok(out.includes('remote pic'), out);
  assert.ok(out.includes('[[not a link]]'), out);
});
