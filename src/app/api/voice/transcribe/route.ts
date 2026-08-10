/**
 * POST /api/voice/transcribe — transcribe voice to text.
 *
 * Accepts: audio/webm (or any ffmpeg-readable format) as raw body.
 * Returns: { transcript: string, latencyMs: number }
 *
 * Requires a valid session cookie (read-level auth).
 * Does NOT execute any command — only returns text.
 */

import { transcribe } from '@/lib/server/voice/recognizer';
import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Auth: session required (any authenticated device can transcribe).
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();

  // Read the raw audio bytes from the request body.
  let audioBuffer: Buffer;
  try {
    const arrayBuffer = await request.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
  } catch {
    return failure('Failed to read audio body.', 400);
  }

  if (audioBuffer.length < 500) {
    // Under 500 bytes is almost certainly a misfire or empty recording.
    return envelope(
      { transcript: '', latencyMs: 0 },
      'sam.voice.transcribe',
      startedAt,
      0,
    );
  }

  try {
    const result = await transcribe(audioBuffer);

    const estate = getEstate();
    return envelope(
      { transcript: result.text, latencyMs: result.latencyMs },
      'sam.voice.transcribe',
      startedAt,
      estate.tick,
    );
  } catch (err) {
    return failure(
      `Transcription failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      500,
    );
  }
}
