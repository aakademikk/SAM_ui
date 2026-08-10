/**
 * POST /api/auth/register/verify — verify WebAuthn registration response.
 *
 * On success, sets session + step-up cookies and returns the new credential.
 */

import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { getCredentialStore, getChallenge } from '@/lib/server/auth/store';
import { createSessionCookies, type SessionPayload } from '@/lib/server/auth/session';
import { RP_ID, ORIGIN } from '@/lib/server/auth/webauthn';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();

  const body = await readJson(request);
  const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 64) : 'unknown';
  const registrationResponse = body.registrationResponse;

  if (!registrationResponse || typeof registrationResponse !== 'object') {
    return failure('registrationResponse is required.', 400);
  }

  // Retrieve the challenge. We stored it by userId during options generation.
  // The client sends back the userId so we can look it up.
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const challenge = getChallenge(userId);
  if (!challenge) {
    return failure('Challenge expired or not found. Start registration again.', 400);
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: registrationResponse as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    const { verified, registrationInfo } = verification;

    if (!verified || !registrationInfo) {
      return failure('Registration verification failed.', 400);
    }

    const store = getCredentialStore();

    await store.add({
      credentialId: registrationInfo.credential.id,
      publicKey: registrationInfo.credential.publicKey,
      counter: registrationInfo.credential.counter,
      transports: registrationInfo.credential.transports ?? [],
      deviceName,
      createdAt: new Date().toISOString(),
    });

    // Create session cookies
    const sessionPayload: SessionPayload = {
      sub: registrationInfo.credential.id,
      device: deviceName,
      iat: Math.floor(Date.now() / 1000),
    };

    const cookies = await createSessionCookies(sessionPayload);

    const estate = getEstate();
    const response = envelope(
      { credentialId: registrationInfo.credential.id, deviceName },
      'sam.auth.register.verify',
      startedAt,
      estate.tick,
    );

    // Set cookies
    for (const cookie of cookies) {
      response.headers.append('Set-Cookie', cookie);
    }

    return response;
  } catch (err) {
    return failure(
      `Verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      400,
    );
  }
}
