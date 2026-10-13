import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackFor, MERMAID_FALLBACK_NOTE } from './MermaidBlock.js';

test('fallbackFor gives the one-line note and keeps the source verbatim', () => {
  const src = 'graph TD\n  A-->B\n\n  B --> C  \n';
  const f = fallbackFor(src, new Error('Parse error'));
  assert.equal(f.note, 'diagram could not be drawn');
  assert.equal(f.note, MERMAID_FALLBACK_NOTE);
  assert.equal(f.source, src);
  assert.equal(f.error, 'Parse error');
});

test('fallbackFor copes with non-Error and missing errors', () => {
  assert.equal(fallbackFor('x', 'boom').error, 'boom');
  assert.equal(fallbackFor('x').error, '');
  assert.equal(fallbackFor('', undefined).source, '');
});
