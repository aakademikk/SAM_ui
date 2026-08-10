/**
 * POST /api/chat/tts — local text-to-speech via Kokoro (sherpa-onnx).
 *
 * Body: { text: string, voice?: number }
 * Returns: audio/wav
 *
 * Runs entirely on CPU. No API keys, no token limits, no network.
 *
 * Requires a valid session cookie.
 */

import { requireSession } from '@/lib/server/auth/guard';
import { failure, readJson } from '@/lib/server/respond';
import { synthesize, VOICES } from '@/lib/server/voice/tts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return failure('text is required.', 400);
  }

  const voiceId = typeof body.voice === 'number' && body.voice >= 0 && body.voice <= 10
    ? body.voice
    : undefined;

  try {
    const result = synthesize(text, voiceId);

    // Build a minimal WAV file (PCM 24kHz 16-bit mono).
    const dataSize = result.pcm.length;
    const wav = Buffer.allocUnsafe(44 + dataSize);

    // RIFF header
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8);

    // fmt chunk
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);         // chunk size
    wav.writeUInt16LE(1, 20);          // PCM
    wav.writeUInt16LE(1, 22);          // mono
    wav.writeUInt32LE(24000, 24);      // sample rate
    wav.writeUInt32LE(48000, 28);      // byte rate
    wav.writeUInt16LE(2, 32);          // block align
    wav.writeUInt16LE(16, 34);         // bits per sample

    // data chunk
    wav.write('data', 36);
    wav.writeUInt32LE(dataSize, 40);
    result.pcm.copy(wav, 44);

    return new Response(wav, {
      headers: {
        'content-type': 'audio/wav',
        'cache-control': 'public, max-age=3600',
        'x-sam-tts-latency-ms': String(result.latencyMs),
        'x-sam-tts-duration-ms': String(Math.round(result.durationSec * 1000)),
      },
    });
  } catch (err) {
    return failure(
      `TTS failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      500,
    );
  }
}

/** GET — list available voices. */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  return Response.json({
    defaultVoice: 7, // bf_emma
    voices: VOICES,
  });
}
