/**
 * GET    /api/auth/devices — list registered credentials.
 * DELETE /api/auth/devices — revoke a credential.
 *
 * Both require a valid session. Revocation also requires step-up.
 */

import { getCredentialStore } from '@/lib/server/auth/store';
import { verifySession, verifyStepUp } from '@/lib/server/auth/session';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startedAt = Date.now();

  const session = await verifySession(request.headers.get('cookie'));
  if (!session) {
    return failure('Not authenticated.', 401);
  }

  const store = getCredentialStore();
  const devices = await store.list();

  const estate = getEstate();
  return envelope(devices, 'sam.auth.devices.list', startedAt, estate.tick);
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();

  const session = await verifySession(request.headers.get('cookie'));
  if (!session) {
    return failure('Not authenticated.', 401);
  }

  // Step-up required for revocation.
  const stepUp = await verifyStepUp(request.headers.get('cookie'));
  if (!stepUp) {
    return failure('Biometric step-up required to revoke a device.', 401);
  }

  const body = await readJson(request);
  const credentialId = typeof body.credentialId === 'string' ? body.credentialId : '';

  if (!credentialId) {
    return failure('credentialId is required.', 400);
  }

  const store = getCredentialStore();
  const removed = await store.remove(credentialId);

  if (!removed) {
    return failure('Credential not found.', 404);
  }

  const estate = getEstate();
  return envelope({ removed: credentialId }, 'sam.auth.devices.revoke', startedAt, estate.tick);
}
