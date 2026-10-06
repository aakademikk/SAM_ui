/**
 * SAM — the chat TTS route's voice-line request body: "elevenlabs" is accepted
 * as the per-request voice and forwarded unchanged; no selection sends no
 * override, so the Edge default (Abeo) applies and ElevenLabs is never reached.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ELEVENLABS_VOICE_ID } from '../../voiceData.js';
import { buildVoiceLineBody } from './voiceLineBody.js';

test('"elevenlabs" is forwarded to voice-line as the voice', () => {
  assert.deepEqual(buildVoiceLineBody('Hello.', ELEVENLABS_VOICE_ID, undefined), {
    text: 'Hello.',
    voice: 'elevenlabs',
  });
});

test('an Edge voice and rate are forwarded as before', () => {
  assert.deepEqual(buildVoiceLineBody('Hi.', 'en-GB-RyanNeural', '+0%'), {
    text: 'Hi.',
    voice: 'en-GB-RyanNeural',
    rate: '+0%',
  });
});

test('no voice, an empty voice or a non-string sends no override', () => {
  for (const v of [undefined, '', 7, null]) {
    assert.deepEqual(buildVoiceLineBody('Hi.', v, undefined), { text: 'Hi.' });
  }
});
