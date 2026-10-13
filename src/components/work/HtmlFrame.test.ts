import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HtmlFrame } from './HtmlFrame.js';
import { WebsiteLink } from './WebsiteLink.js';

test('HtmlFrame sandbox is exactly allow-scripts and src is the encoded file route', () => {
  const out = renderToStaticMarkup(createElement(HtmlFrame, { path: 'Notes/a b&c.html' }));
  assert.match(out, /sandbox="allow-scripts"/);
  assert.ok(!out.includes('allow-same-origin'), out);
  assert.match(out, /src="\/api\/vault\/file\?path=Notes%2Fa%20b%26c\.html"/);
  assert.match(out, /referrerPolicy="no-referrer"/);
  assert.match(out, /title="[^"]*a b&amp;c\.html"/);
});

test('WebsiteLink renders no iframe and a noopener noreferrer link', () => {
  const out = renderToStaticMarkup(createElement(WebsiteLink, { href: 'https://example.com/x' }));
  assert.ok(!out.includes('<iframe'), out);
  assert.match(out, /noopener/);
  assert.match(out, /noreferrer/);
  assert.match(out, /target="_blank"/);
  assert.match(out, /href="https:\/\/example\.com\/x"/);
});

test('WebsiteLink renders no link for non-http(s) addresses', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x.com', 'not a url', '']) {
    const out = renderToStaticMarkup(createElement(WebsiteLink, { href }));
    assert.equal(out, '', href);
  }
});
