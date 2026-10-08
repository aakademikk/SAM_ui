/**
 * SAM — Voice recognizer, run out of process.
 *
 * Wraps sherpa-onnx-node with the NVIDIA Parakeet TDT 0.6B INT8 model, loaded
 * in a child process (scripts/voice-worker.cjs) that exits after
 * SAM_VOICE_IDLE_MS without a request. Loading the model in the server put
 * about 1.55 GB on the glibc brk heap and releasing it handed back almost none
 * (2026-10-07 leak diagnosis), so one voice note pinned it for the life of the
 * server. A worker that exits gives all of it back to the OS.
 *
 * The transducer decoder emits blanks during silence, so it does not
 * hallucinate phantom text from room noise — the key advantage over Whisper
 * for command transcription where false positives turn into executed commands.
 */

import { fork, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';

const modelDir = () =>
  path.join(os.homedir(), '.sam/models/parakeet/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
const workerScript = () =>
  process.env.SAM_VOICE_WORKER ?? path.join(process.cwd(), 'scripts', 'voice-worker.cjs');
const idleMs = () => Number(process.env.SAM_VOICE_IDLE_MS ?? 120_000);

interface Pending { resolve: (text: string) => void; reject: (err: Error) => void }

let worker: ChildProcess | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): ChildProcess {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (worker) return worker;
  const child = fork(workerScript(), [modelDir()], { serialization: 'advanced', stdio: 'inherit' });
  child.on('message', (m: { id: number; text?: string; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.text ?? '');
    armIdle();
  });
  child.on('exit', (code) => {
    if (worker === child) worker = null;
    for (const p of pending.values()) p.reject(new Error(`voice worker exited ${code}`));
    pending.clear();
  });
  worker = child;
  return child;
}

/** Kill the worker once nothing is in flight for idleMs(). */
function armIdle() {
  if (pending.size > 0 || !worker) return;
  const child = worker;
  idleTimer = setTimeout(() => child.kill(), idleMs());
  idleTimer.unref();
}

function recognise(pcm: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    getWorker().send({ id, pcm });
  });
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

  // 2. Run sherpa-onnx inference in the worker.
  const text = await recognise(pcm);

  return {
    text: text.trim(),
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
