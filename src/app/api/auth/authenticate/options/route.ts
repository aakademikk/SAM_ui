/**
 * POST /api/auth/authenticate/options — generate WebAuthn assertion options.
 */

import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getCredentialStore, setChallenge } from '@/lib/server/auth/store';
import { getAuthLimiter } from '@/lib/server/auth/rateLimit';
import { RP_ID } from '@/lib/server/auth/webauthn';
import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!getAuthLimiter().consume(ip)) {
    return failure('Too many auth attempts. Slow down.', 429);
  }

  const store = getCredentialStore();
  const credentials = await store.list();

  if (credentials.length === 0) {
    return failure('No registered credentials. Run registration from the desktop first.', 400);
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
    })),
  });

  // Use a fixed key for the challenge since we don't know which credential
  // the user will use yet.
  setChallenge('auth', options.challenge);

  const estate = getEstate();
  return envelope(options, 'sam.auth.authenticate.options', startedAt, estate.tick);
}
