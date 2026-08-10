/**
 * SAM — Local TTS singleton (Kokoro multi-lang via sherpa-onnx).
 *
 * 53 voices, ~330MB model, runs entirely on CPU.
 * No API keys, no token limits, no network calls.
 *
 * Voice roster: https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { VOICES, DEFAULT_VOICE } from '@/lib/voiceData';

const sherpaRequire = createRequire(import.meta.url);

const MODEL_DIR = path.join(os.homedir(), '.sam/models/kokoro-ml/kokoro-multi-lang-v1_0');

const globalForSam = globalThis as unknown as { __samTts?: TtsInstance };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TtsInstance { tts: any; sampleRate: number }

function createTts(): TtsInstance {
  const sherpa = sherpaRequire('sherpa-onnx-node');

  const modelDir = MODEL_DIR;
  const config = {
    model: {
      kokoro: {
        model: path.join(modelDir, 'model.onnx'),
        voices: path.join(modelDir, 'voices.bin'),
        tokens: path.join(modelDir, 'tokens.txt'),
        dataDir: path.join(modelDir, 'espeak-ng-data'),
        lexicon: [
          path.join(modelDir, 'lexicon-us-en.txt'),
          path.join(modelDir, 'lexicon-zh.txt'),
        ].join(','),
      },
      numThreads: 2,
    },
  };

  const tts = new sherpa.OfflineTts(config);
  return { tts, sampleRate: tts.sampleRate };
}

function getTts(): TtsInstance {
  if (!globalForSam.__samTts) {
    globalForSam.__samTts = createTts();
  }
  return globalForSam.__samTts;
}

/* ========================================================================== */
/* Public API                                                                  */
/* ========================================================================== */

export interface TtsResult {
  pcm: Buffer;
  durationSec: number;
  latencyMs: number;
}

export function synthesize(text: string, voiceId?: number): TtsResult {
  const { tts } = getTts();
  const sid = (voiceId !== undefined && VOICES[voiceId]) ? voiceId : DEFAULT_VOICE;

  const start = Date.now();
  const clamped = text.slice(0, 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audio: any = tts.generate({ text: clamped, sid, speed: 1.0 });

  const samples = audio.samples as Float32Array;
  const pcm = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  return {
    pcm,
    durationSec: samples.length / audio.sampleRate,
    latencyMs: Date.now() - start,
  };
}
