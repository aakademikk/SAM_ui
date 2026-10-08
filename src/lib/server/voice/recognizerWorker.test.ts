/**
 * SAM — the parakeet recogniser must not live in the server process.
 *
 * Loading it adds about 1.55 GB to the glibc brk heap, and dropping it does
 * not hand that back (measured 2026-10-07: brk 690 MB loaded, 614 MB after
 * release and GC). One voice note therefore pinned ~1.5 GB for the life of
 * the server. transcribe() now hands PCM to a child process that exits after
 * SAM_VOICE_IDLE_MS idle, so the OS reclaims all of it.
 *
 * SAM_VOICE_WORKER points at a fake worker that reports its pid and the PCM
 * length, so this needs ffmpeg but no model.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

type Recognizer = typeof import('./recognizer.js');

const tmp = tempDir('voice-worker-');
const PID_FILE = path.join(tmp, 'worker.pid');
const FAKE = path.join(tmp, 'fake-voice-worker.cjs');
const IDLE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let recognizer: Recognizer;

/** 0.5 s of quiet 16 kHz mono 16-bit WAV, enough for ffmpeg to decode. */
function wav(): Buffer {
  const samples = 8000;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 1000), 44 + i * 2);
  return b;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  process.env.HOME = path.join(tmp, 'home');
  fs.writeFileSync(
    FAKE,
    `require('fs').writeFileSync(${JSON.stringify(PID_FILE)}, String(process.pid));\n` +
      `process.on('message', (m) => process.send({ id: m.id, text: 'pcm bytes ' + m.pcm.length }));\n`,
  );
  process.env.SAM_VOICE_WORKER = FAKE;
  process.env.SAM_VOICE_IDLE_MS = String(IDLE_MS);
  recognizer = await import('./recognizer.js');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('transcribe runs in a child process that exits when idle', async () => {
  const result = await recognizer.transcribe(wav());
  assert.match(result.text, /^pcm bytes \d+$/, 'the worker, not the server process, did the recognition');

  const inProcess = (globalThis as { __samVoiceRecognizer?: unknown }).__samVoiceRecognizer;
  assert.equal(inProcess, undefined, 'no recogniser held on the server globalThis');

  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  assert.ok(alive(pid), 'worker is up straight after a request');
  await sleep(IDLE_MS * 4);
  assert.ok(!alive(pid), 'worker exited after the idle window, so its memory went back to the OS');
});
