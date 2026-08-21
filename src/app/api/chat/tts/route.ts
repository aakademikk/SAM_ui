/**
 * POST /api/chat/tts — SAM's chat voice.
 *
 * Body: { text: string, voice?: number }
 * Returns: audio/mpeg
 *
 * Primary: the voice-line Edge service (Abeo) at 127.0.0.1:8790. Falls back
 * to local sherpa-onnx Kokoro if that service is unreachable, so chat audio
 * keeps working even when voice-line is down.
 *
 * Requires a valid session cookie.
 */

import { requireSession } from '@/lib/server/auth/guard';
import { failure, readJson } from '@/lib/server/respond';
import { synthesize } from '@/lib/server/voice/tts';
import { VOICES } from '@/lib/voiceData';

export const dynamic = 'force-dynamic';

const VOICE_LINE_TTS_URL = 'http://127.0.0.1:8790/api/tts';

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return failure('text is required.', 400);
  }

  const voiceId = typeof body.voice === 'number' && body.voice >= 0 && body.voice <= 52
    ? body.voice
    : undefined;
  const edgeVoice = typeof body.edgeVoice === 'string' && body.edgeVoice
    ? body.edgeVoice
    : undefined;

  // Primary: voice-line Edge service (Abeo, or the selected Edge voice).
  try {
    const upstream = await fetch(VOICE_LINE_TTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(edgeVoice ? { voice: edgeVoice } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.ok) {
      const mp3 = await upstream.arrayBuffer();
      return new Response(mp3, {
        headers: {
          'content-type': 'audio/mpeg',
          'cache-control': 'no-store',
        },
      });
    }
  } catch {
    // voice-line unreachable — fall through to local Kokoro
  }

  // Fallback: local sherpa-onnx Kokoro. no-store so a stale fallback WAV is
  // never served once the voice-line service is back.
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
        'cache-control': 'no-store',
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
