/**
 * POST /api/auth/authenticate/verify — verify WebAuthn assertion.
 *
 * On success, sets session + step-up cookies.
 */

import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { getCredentialStore, getChallenge } from '@/lib/server/auth/store';
import { createSessionCookies, type SessionPayload } from '@/lib/server/auth/session';
import { RP_ID, ORIGIN } from '@/lib/server/auth/webauthn';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();

  const body = await readJson(request);
  const assertionResponse = body.assertionResponse;

  if (!assertionResponse || typeof assertionResponse !== 'object') {
    return failure('assertionResponse is required.', 400);
  }

  const challenge = getChallenge('auth');
  if (!challenge) {
    return failure('Challenge expired. Start authentication again.', 400);
  }

  try {
    const store = getCredentialStore();
    const credentialId = (assertionResponse as AuthenticationResponseJSON).id;
    const credential = await store.findByCredentialId(credentialId);

    if (!credential) {
      return failure('Unknown credential. Register first.', 400);
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

    const { verified, authenticationInfo } = verification;

    if (!verified) {
      return failure('Authentication failed — biometric check did not pass.', 401);
    }

    // Update the counter to prevent replay attacks.
    if (authenticationInfo) {
      await store.updateCounter(credentialId, authenticationInfo.newCounter);
    }

    // Create session cookies
    const sessionPayload: SessionPayload = {
      sub: credential.credentialId,
      device: credential.deviceName,
      iat: Math.floor(Date.now() / 1000),
    };

    const cookies = await createSessionCookies(sessionPayload);

    const estate = getEstate();
    const response = envelope(
      { credentialId: credential.credentialId, deviceName: credential.deviceName },
      'sam.auth.authenticate.verify',
      startedAt,
      estate.tick,
    );

    for (const cookie of cookies) {
      response.headers.append('Set-Cookie', cookie);
    }

    return response;
  } catch (err) {
    return failure(
      `Authentication failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      401,
    );
  }
}
