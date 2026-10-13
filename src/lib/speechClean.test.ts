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

// 2026-10-13 (work area): HTML comments, markers included, are never spoken.
const MARKER = '<!-- work: 02 - Atwood Systems/x/Plan Diagram.md -->';
function assertClean(spoken: string, keeps: string[]) {
  for (const bad of ['<!--', 'work', '/', 'Plan Diagram', '.md']) {
    assert.ok(!spoken.includes(bad), `spoken text holds ${JSON.stringify(bad)}: ${spoken}`);
  }
  for (const k of keeps) assert.ok(spoken.includes(k), `spoken text lost ${JSON.stringify(k)}: ${spoken}`);
}

test('a one-line marker before the more line is not spoken', () => {
  const s = say(`Here is the plan.\n${MARKER}\nIt is ready.\n<!-- more -->\nLong detail.`);
  assertClean(s, ['Here is the plan.', 'It is ready.']);
  assert.ok(!s.includes('Long detail'));
});

test('a several-line comment is not spoken', () => {
  const s = say('First sentence.\n<!--\nwork: 02 - Atwood Systems/x/Plan Diagram.md\nmore notes\n-->\nSecond sentence.');
  assertClean(s, ['First sentence.', 'Second sentence.']);
  assert.ok(!s.includes('notes'));
});

test('a marker after the more line is not spoken', () => {
  const s = say(`Short answer.\n<!-- more -->\nLong version.\n${MARKER}`);
  assertClean(s, ['Short answer.']);
});

test('an unterminated comment removes everything after it', () => {
  const s = say('Real sentence.\n<!-- work: 02 - Atwood Systems/x/Plan Diagram.md\nStill hidden.');
  assertClean(s, ['Real sentence.']);
  assert.ok(!s.includes('hidden'));
});
