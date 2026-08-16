/**
 * POST /api/auth/register/options — generate WebAuthn registration options.
 *
 * Policy B (2026-08-16): every enrolment — including the first — requires a
 * one-time token minted by the desktop CLI (`sam-enrol`). The token is
 * consumed here, before any options are generated, so an unauthorised
 * tailnet client cannot even reach the WebAuthn prompt.
 */

import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getCredentialStore, setChallenge } from '@/lib/server/auth/store';
import { consumeEnrolmentToken } from '@/lib/server/auth/enrolmentToken';
import { getRegisterLimiter } from '@/lib/server/auth/rateLimit';
import { RP_ID, RP_NAME } from '@/lib/server/auth/webauthn';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const startedAt = Date.now();

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!getRegisterLimiter().consume(ip)) {
    return failure('Too many registration attempts. Wait a minute.', 429);
  }

  const body = await readJson(request);

  // Policy B gate: consume the one-time enrolment token before anything else.
  // 401 = missing/invalid/expired; 410 = already used (kept distinct so a
  // replay is obvious rather than silently retried).
  const token = typeof body.enrolmentToken === 'string' ? body.enrolmentToken : '';
  if (!token) {
    return failure('An enrolment token is required. Run sam-enrol on the desktop.', 401);
  }
  if (!(await consumeEnrolmentToken(token))) {
    return failure('Enrolment token invalid or already used. Run sam-enrol again.', 410);
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim().slice(0, 64) : '';
  const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 64) : '';
  if (!deviceName) {
    return failure('deviceName is required (e.g. "Colin\'s A16").', 400);
  }

  // userId is the stable identifier across registrations. Default to the
  // device name but make it explicit so re-registration on the same device
  // overwrites the old credential.
  const uid = userId || deviceName;

  const store = getCredentialStore();
  const existingCredentials = await store.list();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: uid,
    userDisplayName: deviceName,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.credentialId,
    })),
    authenticatorSelection: {
      // Don't force 'platform' — Linux desktops have no platform authenticator.
      // Android Chrome → fingerprint, Mac → Touch ID, Linux → USB key or phone QR.
      userVerification: 'required',
      residentKey: 'preferred',
    },
  });

  setChallenge(uid, options.challenge);

  const estate = getEstate();
  return envelope(options, 'sam.auth.register.options', startedAt, estate.tick);
}
