import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView, codeText } from './MarkdownView.js';

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

/** Walk a React element tree for the first element whose type is ReactMarkdown (the one with a `components` prop). */
function findComponentsProp(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const el = node as { props?: { components?: Record<string, unknown>; children?: unknown } };
  if (el.props?.components) return el.props.components;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = findComponentsProp(k);
    if (found) return found;
  }
  return undefined;
}

test('refresh cause: the renderer map keeps its identity across re-renders, so the DOM is not remounted', () => {
  // react-markdown treats each entry of `components` as a component type. A map rebuilt on
  // every MarkdownView render gives React new types, so the whole subtree remounts each time
  // the chat page re-renders (twice a second while running, every 5 s from the chat poll),
  // dropping code-block scroll position, selection and copy focus.
  const a = findComponentsProp((MarkdownView as unknown as (p: { source: string }) => unknown)({ source: '```\nx\n```' }));
  const b = findComponentsProp((MarkdownView as unknown as (p: { source: string }) => unknown)({ source: '```\nx\n```' }));
  assert.ok(a && b);
  for (const key of Object.keys(a)) assert.equal(a[key], b[key], `components.${key} changes identity between renders`);
});

test('code blocks wrap instead of scrolling sideways and carry a copy button', () => {
  const out = render('```js\nconst veryLongLine = 1; // ' + 'x'.repeat(200) + '\n```');
  const pre = /<pre[^>]*class="([^"]*)"/.exec(out);
  assert.ok(pre, out);
  assert.ok(pre[1].includes('whitespace-pre-wrap'), pre[1]);
  assert.ok(/break-(words|all)|\[overflow-wrap:anywhere\]/.test(pre[1]), pre[1]);
  assert.ok(!pre[1].includes('overflow-x-auto'), pre[1]);
  assert.ok(/<button[^>]*aria-label="Copy code"/.test(out), out);
  assert.ok(out.includes('Copy</'), out);
});

test('codeText gives the raw code exactly, without the fence newline', () => {
  const node = {
    type: 'element',
    tagName: 'pre',
    children: [
      {
        type: 'element',
        tagName: 'code',
        children: [{ type: 'text', value: 'a  <b>\n\tc && d\n' }],
      },
    ],
  };
  assert.equal(codeText(node), 'a  <b>\n\tc && d');
});
