/**
 * SAM — the chat TTS route's voice-line request body: "elevenlabs" is accepted
 * as the per-request voice and forwarded unchanged; no selection sends no
 * override, so the Edge default (Abeo) applies and ElevenLabs is never reached.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { ELEVENLABS_VOICE_ID } from '../../voiceData.js';
import { buildVoiceLineBody, voiceLineSignal } from './voiceLineBody.js';

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

/*
 * Review finding 4: stopping speech must cancel the paid upstream request. The
 * route's upstream fetch takes voiceLineSignal(request.signal, ms), so an abort
 * from the browser (stop, or a new turn) reaches voice-line as well as the
 * timeout. The route itself cannot be loaded under the test compile (tts.ts
 * uses import.meta), so the behaviour is tested on the helper and the wiring
 * is checked in the route source.
 */

test('finding 4: aborting the request signal aborts the upstream signal', () => {
  const controller = new AbortController();
  const signal = voiceLineSignal(controller.signal, 60_000);
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(signal.aborted, true);
});

test('finding 4: an already-aborted request gives an already-aborted signal', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(voiceLineSignal(controller.signal, 60_000).aborted, true);
});

test('finding 4: the timeout still aborts when the request stays live', async () => {
  const controller = new AbortController();
  const signal = voiceLineSignal(controller.signal, 20);
  assert.equal(signal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(signal.aborted, true);
  assert.equal(controller.signal.aborted, false);
});

test('finding 4: the chat TTS route passes request.signal to the upstream fetch', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../../src/app/api/chat/tts/route.ts'),
    'utf8',
  );
  assert.match(source, /voiceLineSignal\(\s*request\.signal\s*,\s*VOICE_LINE_TIMEOUT_MS\s*\)/);
  assert.doesNotMatch(source, /signal:\s*AbortSignal\.timeout\(/);
});
