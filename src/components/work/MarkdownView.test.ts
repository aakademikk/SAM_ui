import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from './MarkdownView.js';

function render(source: string): string {
  return renderToStaticMarkup(createElement(MarkdownView, { source }));
}

test('raw HTML and javascript: links never reach the output as live markup', () => {
  const out = render(
    [
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '<iframe src="https://example.com"></iframe>',
      '',
      '[x](javascript:alert(1))',
    ].join('\n'),
  );
  assert.ok(!out.includes('<script'), out);
  // Raw HTML is shown as escaped text (Must 15), so the word onerror= may appear
  // as text; what must never appear is a live tag carrying it.
  assert.ok(!out.includes('<img'), out);
  assert.ok(!/<[^>]*onerror=/i.test(out), out);
  assert.ok(out.includes('&lt;script&gt;'), out);
  assert.ok(!out.includes('<iframe'), out);
  assert.ok(!out.includes('javascript:'), out);
});

test('headings, bold, table, checklist and rule render', () => {
  const out = render(
    [
      '# Title',
      '',
      '**bold**',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '---',
    ].join('\n'),
  );
  assert.ok(out.includes('<h1'));
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('<table'));
  assert.ok(out.includes('overflow-x-auto'));
  assert.ok(out.includes('<hr'));
  assert.equal((out.match(/<input[^>]*disabled/g) ?? []).length, 2);
  assert.equal((out.match(/<input[^>]*checked/g) ?? []).length, 1);
});

test('outside links open in a new tab without a referrer', () => {
  const out = render('[site](https://example.com/a)');
  assert.ok(out.includes('target="_blank"'));
  assert.ok(out.includes('noreferrer'));
  assert.ok(out.includes('href="https://example.com/a"'));
});

test('mermaid blocks render a scrolling diagram container, with no pre nested in a pre', () => {
  const out = render('```mermaid\ngraph TD; A-->B\n```');
  assert.ok(out.includes('overflow-x-auto'));
  assert.ok(!out.includes('<pre'));
});
