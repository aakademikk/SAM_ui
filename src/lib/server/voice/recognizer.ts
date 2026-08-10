/**
 * SAM — Voice recognizer singleton.
 *
 * Wraps sherpa-onnx-node with the NVIDIA Parakeet TDT 0.6B INT8 model.
 * Loaded once on first use; cached on globalThis.
 *
 * The transducer decoder emits blanks during silence, so it does not
 * hallucinate phantom text from room noise — the key advantage over Whisper
 * for command transcription where false positives turn into executed commands.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';

const MODEL_DIR = path.join(
  os.homedir(),
  '.sam/models/parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
);

// We import sherpa-onnx-node lazily — it's a native addon that should not
// be loaded during Next.js compilation.
const sherpaRequire = createRequire(import.meta.url);

let sherpaModule: ReturnType<typeof sherpaRequire> | null = null;

function getSherpa() {
  if (!sherpaModule) {
    sherpaModule = sherpaRequire('sherpa-onnx-node');
  }
  return sherpaModule;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface RecognizerInstance { recognizer: any }

const globalForSam = globalThis as unknown as { __samVoiceRecognizer?: RecognizerInstance };

function createRecognizer(): RecognizerInstance {
  const sherpa = getSherpa();

  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 128,
    },
    modelConfig: {
      transducer: {
        encoder: path.join(MODEL_DIR, 'encoder.int8.onnx'),
        decoder: path.join(MODEL_DIR, 'decoder.int8.onnx'),
        joiner: path.join(MODEL_DIR, 'joiner.int8.onnx'),
      },
      tokens: path.join(MODEL_DIR, 'tokens.txt'),
      numThreads: 4,
    },
  };

  const recognizer = new sherpa.OfflineRecognizer(config);
  return { recognizer };
}

function getRecognizerInstance(): RecognizerInstance {
  if (!globalForSam.__samVoiceRecognizer) {
    globalForSam.__samVoiceRecognizer = createRecognizer();
  }
  return globalForSam.__samVoiceRecognizer;
}

/* ========================================================================== */
/* Public API                                                                  */
/* ========================================================================== */

export interface TranscriptionResult {
  text: string;
  /** Wall-clock time for ffmpeg + inference, in ms. */
  latencyMs: number;
}

/**
 * Transcribe an audio buffer (any format ffmpeg can read — webm, opus, wav,
 * mp3, etc.) to text.
 *
 * Pipeline: ffmpeg → 16kHz mono f32le PCM → sherpa-onnx → text.
 */
export async function transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
  const start = Date.now();

  // 1. Decode to 16kHz mono f32le PCM via ffmpeg.
  const pcm = await decodeToPcm(audioBuffer);

  if (pcm.length === 0) {
    return { text: '', latencyMs: Date.now() - start };
  }

  // 2. Run sherpa-onnx inference.
  const { recognizer } = getRecognizerInstance();

  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);

  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });

  recognizer.decode(stream);

  const result = recognizer.getResult(stream);

  return {
    text: (result?.text ?? '').trim(),
    latencyMs: Date.now() - start,
  };
}

/**
 * Convert any audio format to 16kHz mono f32le PCM using ffmpeg.
 */
function decodeToPcm(audioBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn('ffmpeg', [
      '-i', 'pipe:0',          // read from stdin
      '-ar', '16000',           // 16kHz
      '-ac', '1',               // mono
      '-f', 'f32le',            // 32-bit float little-endian
      '-v', 'error',            // suppress logs
      'pipe:1',                 // write to stdout
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = child.stderr?.read();
        reject(new Error(`ffmpeg exited ${code}: ${stderr?.toString() ?? 'unknown error'}`));
      }
    });

    child.on('error', reject);

    // Pipe the audio buffer to ffmpeg's stdin.
    const stdin = Readable.from(audioBuffer);
    stdin.pipe(child.stdin);
  });
}
