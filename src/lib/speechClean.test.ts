/**
 * SAM — what the voice reads aloud (2026-10-12).
 *
 * Colin hears chat through text-to-speech. A reply that links a vault note
 * was read out as "slash home slash col ... percent twenty ...", and item ids
 * and dashes came out as noise too. `splitForSpeech` keeps the words a person
 * would say and drops what only makes sense on screen. The chat bubble still
 * shows everything; only the spoken copy is cleaned.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitForSpeech } from '@/lib/speech';

const say = (text: string) => splitForSpeech(text).join(' ');

test('a markdown link is read as its label, never its address', () => {
  const out = say(
    'Logged in [today\'s note](/home/col/ai-memory-vault/01%20-%20Daily%20Notes/2026-10-12.md).',
  );
  assert.equal(out, "Logged in today's note.");
});

test('bare web addresses are not read out', () => {
  assert.equal(say('See https://example.com/a?b=c%20d for more.'), 'See for more.');
});

test('file paths are not read out, in or out of code marks', () => {
  assert.equal(say('I changed `~/.sam/morning-brief/publish.py` and /home/col/SAM_ui/deploy.sh today.'), 'I changed and today.');
});

test('percent escapes left over are not read out', () => {
  assert.equal(say('Daily%20Notes is the folder.'), 'Daily Notes is the folder.');
});

test('waiting item ids are not read out, nor the empty brackets they leave', () => {
  assert.equal(say('Shall I install it now (w_0873e338)?'), 'Shall I install it now?');
});

test('dashes become a pause, not a word; hyphenated words stay', () => {
  assert.equal(say('The fix landed — tests pass - all of them. A made-to-measure job.'),
    'The fix landed, tests pass, all of them. A made-to-measure job.');
});

test('nothing after a <!-- more --> line is read out', () => {
  assert.equal(say('Short answer.\n<!-- more -->\nThe long version.'), 'Short answer.');
});
