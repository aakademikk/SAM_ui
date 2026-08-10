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

const sherpaRequire = createRequire(import.meta.url);

// Multi-lang model with 53 voices including bm_daniel
const MODEL_DIR = path.join(os.homedir(), '.sam/models/kokoro-ml/kokoro-multi-lang-v1_0');

/** Full voice roster for the multi-lang v1.0 model. */
export const VOICES: Record<number, string> = {
  0: 'af_alloy', 1: 'af_aoede', 2: 'af_bella', 3: 'af_heart',
  4: 'af_jessica', 5: 'af_kore', 6: 'af_nicole', 7: 'af_nova',
  8: 'af_river', 9: 'af_sarah', 10: 'af_sky',
  11: 'am_adam', 12: 'am_echo', 13: 'am_eric', 14: 'am_fenrir',
  15: 'am_liam', 16: 'am_michael', 17: 'am_onyx', 18: 'am_puck', 19: 'am_santa',
  20: 'bf_alice', 21: 'bf_emma', 22: 'bf_isabella', 23: 'bf_lily',
  24: 'bm_daniel', 25: 'bm_fable', 26: 'bm_george', 27: 'bm_lewis',
  28: 'ef_dora', 29: 'em_alex',
  30: 'ff_siwis',
  31: 'hf_alpha', 32: 'hf_beta', 33: 'hm_omega', 34: 'hm_psi',
  35: 'if_sara', 36: 'im_nicola',
  37: 'jf_alpha', 38: 'jf_gongitsune', 39: 'jf_nezumi', 40: 'jf_tebukuro', 41: 'jm_kumo',
  42: 'pf_dora', 43: 'pm_alex', 44: 'pm_santa',
  45: 'zf_xiaobei', 46: 'zf_xiaoni', 47: 'zf_xiaoxiao', 48: 'zf_xiaoyi',
  49: 'zm_yunjian', 50: 'zm_yunxi', 51: 'zm_yunxia', 52: 'zm_yunyang',
};

/** Grouped for UI display. */
export const VOICE_GROUPS: { label: string; voices: { id: number; name: string }[] }[] = [
  {
    label: 'British Male',
    voices: [24, 25, 26, 27].map((id) => ({ id, name: VOICES[id] })),
  },
  {
    label: 'British Female',
    voices: [20, 21, 22, 23].map((id) => ({ id, name: VOICES[id] })),
  },
  {
    label: 'American Male',
    voices: [11, 12, 13, 14, 15, 16, 17, 18, 19].map((id) => ({ id, name: VOICES[id] })),
  },
  {
    label: 'American Female',
    voices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({ id, name: VOICES[id] })),
  },
];

const DEFAULT_VOICE = 24; // bm_daniel — British Male, matches SAM's personality

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
