/**
 * SAM — Enter on a phone's keyboard starts a new line, not a send (Colin,
 * 2026-10-05). Desktop keeps Enter to send, Shift+Enter for a new line.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { enterSends } from './composerEnter.js';

test('desktop: Enter sends, Shift+Enter does not', () => {
  assert.equal(enterSends({ key: 'Enter', shiftKey: false }, false), true);
  assert.equal(enterSends({ key: 'Enter', shiftKey: true }, false), false);
});

test('touch keyboard: Enter never sends', () => {
  assert.equal(enterSends({ key: 'Enter', shiftKey: false }, true), false);
  assert.equal(enterSends({ key: 'Enter', shiftKey: true }, true), false);
});

test('other keys never send', () => {
  assert.equal(enterSends({ key: 'a', shiftKey: false }, false), false);
});

test('the chat composer routes Enter through enterSends', () => {
  // The page is React and cannot be mounted in this suite (no jsdom), so pin
  // the wiring: a bare Enter check would send on a phone again.
  const root = path.resolve(__dirname, '../../src');
  const source = fs.readFileSync(path.join(root, 'app/(app)/chat/page.tsx'), 'utf-8');
  assert.match(source, /enterSends\(e, isTouchKeyboard\(\)\)/);
  assert.doesNotMatch(source, /e\.key === 'Enter' && !e\.shiftKey/);
});
