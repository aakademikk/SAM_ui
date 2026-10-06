/**
 * SAM — voiceData.ts: the Settings voice picker roster. "SAM (ElevenLabs)" is
 * offered as a paid option; the free Edge voice stays the default so
 * ElevenLabs only runs when Colin selects it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_EDGE_VOICE, EDGE_VOICE_GROUPS, ELEVENLABS_VOICE_ID } from './voiceData.js';

const all = EDGE_VOICE_GROUPS.flatMap((g) => g.voices);

test('the picker offers SAM (ElevenLabs), labelled as paid, with id "elevenlabs"', () => {
  assert.equal(ELEVENLABS_VOICE_ID, 'elevenlabs');
  const entry = all.find((v) => v.id === 'elevenlabs');
  assert.ok(entry, 'no elevenlabs entry in EDGE_VOICE_GROUPS');
  assert.match(entry.name, /SAM \(ElevenLabs\)/);
  assert.match(entry.name, /paid/i);
});

test('the default voice is still the free Edge Abeo voice', () => {
  assert.equal(DEFAULT_EDGE_VOICE, 'en-NG-AbeoNeural');
  assert.ok(all.some((v) => v.id === DEFAULT_EDGE_VOICE));
});

test('voice ids in the picker are unique', () => {
  assert.equal(new Set(all.map((v) => v.id)).size, all.length);
});
