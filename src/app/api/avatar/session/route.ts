/**
 * POST /api/avatar/session
 *
 * Exchanges the server-side Simli API key for a session token and ICE servers.
 * The raw API key NEVER reaches the browser.
 *
 * Real Simli API (from simli-client v3.0.2 source):
 *   POST https://api.simli.ai/compose/token  → session token
 *   GET  https://api.simli.ai/compose/ice    → ICE servers
 */
import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/server/auth/guard';
import type { AvatarErrorPayload, AvatarSession } from '@/types/avatar';

const SIMLI_API_BASE = 'https://api.simli.ai';

/*
 * Session-gated 2026-09-20 (SAM_ui_Audit_2026-09-20 finding 6). Every call here
 * spends a real Simli session against a paid quota, and it was reachable by any
 * client on the origin with nothing to prove who they were. That makes it a
 * quota-drain primitive, not merely an information leak — which is why it is
 * worth gating even though the avatar feature is currently disabled.
 */
export async function POST(
  request: Request,
): Promise<NextResponse<AvatarSession | AvatarErrorPayload>> {
  const session = await requireSession(request);
  if (session instanceof Response) {
    return session as NextResponse<AvatarErrorPayload>;
  }

  const apiKey = process.env.SIMLI_API_KEY;
  const faceId = process.env.SIMLI_FACE_ID;

  if (!apiKey || !faceId) {
    return NextResponse.json<AvatarErrorPayload>(
      {
        code: 'CONFIG_MISSING',
        message: 'Server avatar configuration is incomplete. Set SIMLI_API_KEY and SIMLI_FACE_ID.',
      },
      { status: 500 },
    );
  }

  try {
    // 1. Fetch session token from Simli
    const tokenRes = await fetch(`${SIMLI_API_BASE}/compose/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simli-api-key': apiKey,
      },
      body: JSON.stringify({
        faceId,
        handleSilentAudio: true,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      return NextResponse.json<AvatarErrorPayload>(
        {
          code: 'SIMLI_AUTH_FAILED',
          message: `Simli token request failed (${tokenRes.status}): ${errorText.slice(0, 300)}`,
        },
        { status: 502 },
      );
    }

    const tokenBody = (await tokenRes.json()) as Record<string, unknown>;
    // The real API returns the token under various keys — try the common ones
    const sessionToken =
      (tokenBody.token as string) ??
      (tokenBody.sessionToken as string) ??
      (tokenBody.session_token as string) ??
      '';

    if (!sessionToken) {
      return NextResponse.json<AvatarErrorPayload>(
        {
          code: 'SIMLI_SESSION_FAILED',
          message: `Simli returned no session token. Keys in response: ${Object.keys(tokenBody).join(', ') || '(none)'}`,
        },
        { status: 502 },
      );
    }

    // 2. Fetch ICE servers
    let iceServers: RTCIceServer[] = [];
    try {
      const iceRes = await fetch(`${SIMLI_API_BASE}/compose/ice`, {
        headers: {
          'Content-Type': 'application/json',
          'x-simli-api-key': apiKey,
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (iceRes.ok) {
        const iceBody = (await iceRes.json()) as RTCIceServer[];
        if (Array.isArray(iceBody) && iceBody.length > 0) {
          iceServers = iceBody;
        }
      }
    } catch {
      // ICE fetch is non-fatal — the client falls back to Google STUN
    }

    return NextResponse.json<AvatarSession>({
      sessionToken,
      faceId,
      iceServers,
      expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error creating Simli session';
    return NextResponse.json<AvatarErrorPayload>(
      { code: 'SIMLI_SESSION_FAILED', message },
      { status: 502 },
    );
  }
}
