/**
 * POST /api/chat/tts — text-to-speech via ElevenLabs.
 *
 * Body: { text: string }
 * Returns: audio/mpeg stream
 *
 * Requires a valid session cookie.
 */

import { requireSession } from '@/lib/server/auth/guard';
import { failure, readJson } from '@/lib/server/respond';

export const dynamic = 'force-dynamic';

const API_KEY = process.env.ELEVENLABS_API_KEY ?? '';
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  if (!API_KEY) {
    return failure('ELEVENLABS_API_KEY not configured.', 500);
  }

  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return failure('text is required.', 400);
  }

  // Cap text length to avoid abuse.
  const capped = text.slice(0, 1000);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'xi-api-key': API_KEY,
        },
        body: JSON.stringify({
          text: capped,
          model_id: 'eleven_flash_v2_5', // fast streaming model
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return failure(`TTS failed: ${response.status} — ${errText.slice(0, 120)}`, 500);
    }

    // Stream the audio back to the client.
    return new Response(response.body, {
      headers: {
        'content-type': response.headers.get('content-type') ?? 'audio/mpeg',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return failure(`TTS request failed: ${err instanceof Error ? err.message : 'unknown'}`, 500);
  }
}
