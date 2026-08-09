/**
 * POST /api/avatar/tts
 *
 * Proxies text-to-speech requests to ElevenLabs.  The API key lives on the
 * server — the client never sees it.  Audio chunks are streamed back as
 * raw PCM 16kHz so the Simli WebRTC engine can push them directly into the
 * lip-sync pipeline without re-encoding.
 *
 * The route streams the response body byte-for-byte from ElevenLabs so the
 * client can process chunks as they arrive — no buffering the full clip.
 */
import { NextResponse } from 'next/server';

import type { AvatarErrorPayload, TTSRequest } from '@/types/avatar';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

export async function POST(request: Request): Promise<NextResponse | Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID;

  // ------------------------------------------------------------------
  // Guard: server config
  // ------------------------------------------------------------------
  if (!apiKey) {
    return NextResponse.json<AvatarErrorPayload>(
      {
        code: 'CONFIG_MISSING',
        message: 'Server TTS configuration is incomplete. Set ELEVENLABS_API_KEY.',
      },
      { status: 500 },
    );
  }

  // ------------------------------------------------------------------
  // Parse & validate request body
  // ------------------------------------------------------------------
  let body: TTSRequest;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
      return NextResponse.json<AvatarErrorPayload>(
        { code: 'TTS_FAILED', message: 'Missing or empty "text" field.' },
        { status: 400 },
      );
    }
    body = {
      text: raw.text as string,
      voiceId: typeof raw.voiceId === 'string' ? raw.voiceId : undefined,
    };
  } catch {
    return NextResponse.json<AvatarErrorPayload>(
      { code: 'TTS_FAILED', message: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const voiceId = body.voiceId ?? defaultVoiceId;
  if (!voiceId) {
    return NextResponse.json<AvatarErrorPayload>(
      {
        code: 'CONFIG_MISSING',
        message: 'No voice ID provided and no ELEVENLABS_VOICE_ID default configured.',
      },
      { status: 500 },
    );
  }

  // ------------------------------------------------------------------
  // Enforce a reasonable character limit to prevent abuse
  // ------------------------------------------------------------------
  const MAX_CHARS = 2_000;
  if (body.text.length > MAX_CHARS) {
    return NextResponse.json<AvatarErrorPayload>(
      {
        code: 'TTS_FAILED',
        message: `Text exceeds the ${MAX_CHARS}-character limit (received ${body.text.length}).`,
      },
      { status: 400 },
    );
  }

  // ------------------------------------------------------------------
  // Proxy to ElevenLabs — stream the response directly
  // ------------------------------------------------------------------
  try {
    const upstream = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: body.text,
          model_id: 'eleven_turbo_v2_5',
          output_format: 'pcm_16000',
          // Optimise for streaming latency over quality
          optimize_streaming_latency: 3,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!upstream.ok) {
      const errorText = await upstream.text();
      const code = 'TTS_FAILED' as const;
      return NextResponse.json<AvatarErrorPayload>(
        {
          code,
          message: `ElevenLabs returned ${upstream.status}: ${errorText.slice(0, 300)}`,
        },
        { status: 502 },
      );
    }

    if (!upstream.body) {
      return NextResponse.json<AvatarErrorPayload>(
        { code: 'TTS_FAILED', message: 'ElevenLabs returned an empty response body.' },
        { status: 502 },
      );
    }

    // ------------------------------------------------------------------
    // Relay the raw audio stream with appropriate headers
    // ------------------------------------------------------------------
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/x-raw',
        'X-Audio-Format': 'pcm_16000',
        'Cache-Control': 'no-store, max-age=0',
        // Let the client correlate this stream
        'X-TTS-Request-Id': crypto.randomUUID?.() ?? '',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error proxying TTS';
    return NextResponse.json<AvatarErrorPayload>(
      { code: 'TTS_FAILED', message },
      { status: 502 },
    );
  }
}
