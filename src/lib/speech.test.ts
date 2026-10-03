/**
 * SAM — the welcome line's audio path (2026-10-02).
 *
 * The greeting is a pre-rendered file played through the existing shared audio
 * element, not a synthesised utterance, so nothing else in this suite touches
 * it. All three ways it can break are silent in the browser: a renamed or
 * deleted asset, a URL that drifts from where the file actually sits, and a
 * `playGreeting()` that stops registering in `liveStops` so the mute button no
 * longer silences it. Each would only ever be noticed by ear.
 *
 * These checks are the tripwire. There is no DOM here — `node --test` runs the
 * emitted CommonJS with no jsdom — so `Audio` is stubbed, which is enough to
 * prove the wiring without pretending to prove the sound. The stub is safe to
 * install after the import because speech.ts only touches `new Audio()` when a
 * function is called, never at module load.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { playGreeting, stopAllSpeech } from '@/lib/speech';

const GREETING_PATH = '/greeting/sam-greeting-v2.mp3';

/** Records what speech.ts actually asked the element to do. */
class FakeAudio {
  static latest: FakeAudio | null = null;
  src = '';
  currentTime = 0;
  preload = '';
  paused = true;
  playCalls = 0;
  private listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.latest = this;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
}

(globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;

test('the greeting asset exists where the URL points', () => {
  // Guards a rename, a move or a deleted file: the app would otherwise 404 the
  // clip in silence and the line would simply never be heard.
  assert.ok(
    existsSync(path.join(process.cwd(), 'public', GREETING_PATH)),
    `missing public${GREETING_PATH}`,
  );
});

test('playGreeting plays the pre-rendered file from the start', () => {
  const handle = playGreeting();
  const audio = FakeAudio.latest;
  assert.ok(audio, 'playGreeting did not touch the shared audio element');
  assert.equal(audio.src, GREETING_PATH);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCalls, 1, 'the clip was never played');
  handle.stop();
});

test('the mute button silences the greeting, not just an answer', () => {
  playGreeting();
  const audio = FakeAudio.latest!;
  assert.equal(audio.paused, false, 'precondition: the greeting is playing');

  stopAllSpeech();

  assert.equal(audio.paused, true, 'stopAllSpeech left the greeting talking');
});
