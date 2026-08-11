/**
 * POST /api/auth/stepup — re-authenticate for write operations.
 *
 * Requires a valid sam-session cookie (proves who you are).
 * Does a fresh biometric check and issues a new sam-stepup cookie.
 */

import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { AuthenticatorTransport } from '@simplewebauthn/server';
import { getCredentialStore, setChallenge, getChallenge } from '@/lib/server/auth/store';
import { createStepUpCookie, verifySession, type SessionPayload } from '@/lib/server/auth/session';
import { RP_ID, ORIGIN } from '@/lib/server/auth/webauthn';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { getAuthLimiter } from '@/lib/server/auth/rateLimit';

export const dynamic = 'force-dynamic';

/** GET — generate assertion options for step-up (requires valid session). */
export async function GET(request: Request) {
  const startedAt = Date.now();

  const session = await verifySession(request.headers.get('cookie'));
  if (!session) {
    return failure('Not authenticated. Log in first.', 401);
  }

  const store = getCredentialStore();
  const credential = await store.findByCredentialId(session.sub);
  if (!credential) {
    return failure('Credential not found. Re-register.', 401);
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: [{
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransport[],
    }],
  });

  setChallenge(`stepup:${session.sub}`, options.challenge, 60_000);

  const estate = getEstate();
  return envelope(options, 'sam.auth.stepup.options', startedAt, estate.tick);
}

/** POST — verify assertion and issue step-up cookie. */
export async function POST(request: Request) {
  const startedAt = Date.now();

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!getAuthLimiter().consume(`${ip}:stepup`)) {
    return failure('Too many attempts. Slow down.', 429);
  }

  const session = await verifySession(request.headers.get('cookie'));
  if (!session) {
    return failure('Not authenticated. Log in first.', 401);
  }

  const body = await readJson(request);
  const assertionResponse = body.assertionResponse;
  if (!assertionResponse || typeof assertionResponse !== 'object') {
    return failure('assertionResponse is required.', 400);
  }

  const challenge = getChallenge(`stepup:${session.sub}`);
  if (!challenge) {
    return failure('Challenge expired. Call GET /api/auth/stepup first.', 400);
  }

  try {
    const store = getCredentialStore();
    const credential = await store.findByCredentialId(session.sub);

    if (!credential) {
      return failure('Credential not found.', 401);
    }

    const verification = await verifyAuthenticationResponse({
      response: assertionResponse as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
      } as Parameters<typeof verifyAuthenticationResponse>[0]['credential'],
    });

    if (!verification.verified) {
      return failure('Biometric check failed.', 401);
    }

    if (verification.authenticationInfo) {
      await store.updateCounter(credential.credentialId, verification.authenticationInfo.newCounter);
    }

    const stepupPayload: SessionPayload = {
      sub: credential.credentialId,
      device: credential.deviceName,
      iat: Math.floor(Date.now() / 1000),
    };

    // The window scales with how expensive re-authenticating is: a built-in
    // authenticator (phone fingerprint) stays short, the hybrid/QR flow a
    // desktop has to use gets the long one.
    const cookie = await createStepUpCookie(
      stepupPayload,
      (assertionResponse as AuthenticationResponseJSON).authenticatorAttachment,
    );

    const estate = getEstate();
    const response = envelope(
      { stepUp: true, deviceName: credential.deviceName },
      'sam.auth.stepup.verify',
      startedAt,
      estate.tick,
    );

    response.headers.append('Set-Cookie', cookie);
    return response;
  } catch (err) {
    return failure(
      `Step-up failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      401,
    );
  }
}
