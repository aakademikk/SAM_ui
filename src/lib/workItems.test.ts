/**
 * SAM — work-area marker parsing and card labels (spec must-do 1, 2, 7).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALLOWED_TYPES, cardFor, fileName, kindFor, parseMarkers } from './workItems.js';

test('parseMarkers: several markers are collected in order and their lines removed', () => {
  const src = 'Here you go.\n<!-- work: 02 - Atwood Systems/Plan.md -->\nMore text.\n  <!--work:diagram.png-->  \nEnd.';
  const { text, markers } = parseMarkers(src);
  assert.deepEqual(markers, [
    { target: '02 - Atwood Systems/Plan.md', isWeb: false },
    { target: 'diagram.png', isWeb: false },
  ]);
  assert.equal(text.includes('work:'), false);
  assert.equal(text.includes('<!--'), false);
  assert.ok(text.includes('Here you go.') && text.includes('More text.') && text.includes('End.'));
});

test('parseMarkers: an absolute path inside the vault is made relative', () => {
  const { markers } = parseMarkers('<!-- work: /home/col/ai-memory-vault/03 - Personal/Book.pdf -->');
  assert.deepEqual(markers, [{ target: '03 - Personal/Book.pdf', isWeb: false }]);
});

test('parseMarkers: a web address is flagged as web', () => {
  const { markers } = parseMarkers('<!-- work: https://example.com/page -->');
  assert.deepEqual(markers, [{ target: 'https://example.com/page', isWeb: true }]);
});

test('parseMarkers: an ordinary comment is left alone', () => {
  const src = 'a\n<!-- note: keep me -->\nb';
  const { text, markers } = parseMarkers(src);
  assert.equal(text, src);
  assert.deepEqual(markers, []);
});

test('kindFor: every allowed type, and null for the rest', () => {
  assert.equal(ALLOWED_TYPES.length, 11);
  const want: Record<string, string> = {
    'a.md': 'document', 'a.pdf': 'document', 'a.html': 'page',
    'a.png': 'image', 'a.jpg': 'image', 'a.jpeg': 'image', 'a.gif': 'image', 'a.webp': 'image', 'a.svg': 'image',
    'a.mp4': 'video', 'a.webm': 'video', 'A.MD': 'document', 'https://x.com/a': 'website',
  };
  for (const [t, k] of Object.entries(want)) assert.equal(kindFor(t), k, t);
  for (const t of ['a.txt', 'a.mov', 'a.docx', 'noext']) assert.equal(kindFor(t), null, t);
});

test('fileName: last path part', () => {
  assert.equal(fileName('a/b/Plan.md'), 'Plan.md');
});

test('cardFor: labels and openable rules', () => {
  const m = { target: 'Projects/Plan.md', isWeb: false };
  assert.deepEqual(
    cardFor(m, { path: m.target, available: false, kind: null, title: null, size: null }),
    { label: 'not available: Plan.md', kind: null, openable: false },
  );
  assert.deepEqual(cardFor(m, null), { label: 'Plan.md', kind: 'document', openable: false });
  assert.deepEqual(
    cardFor(m, { path: m.target, available: true, kind: 'document', title: 'The Plan', size: 5 }),
    { label: 'The Plan', kind: 'document', openable: true },
  );
  assert.equal(cardFor(m, { path: m.target, available: true, kind: 'document', title: null, size: 5 }).label, 'Plan.md');
  assert.deepEqual(
    cardFor({ target: 'https://www.example.com/x', isWeb: true }, null),
    { label: 'www.example.com', kind: 'website', openable: true },
  );
  const bad = { target: 'a/Clip.mov', isWeb: false };
  assert.deepEqual(cardFor(bad, null), { label: 'not available: Clip.mov', kind: null, openable: false });
});
