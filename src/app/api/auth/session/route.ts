/**
 * GET /api/auth/session — check current session state.
 */

import { verifySession, verifyStepUp } from '@/lib/server/auth/session';
import { envelope, failure } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const startedAt = Date.now();
  const cookie = request.headers.get('cookie');

  const session = await verifySession(cookie);
  const stepUp = await verifyStepUp(cookie);

  const estate = getEstate();

  if (!session) {
    return failure('Not authenticated.', 401);
  }

  return envelope(
    {
      authenticated: true,
      device: session.device,
      stepUp: !!stepUp,
      sessionCreated: new Date(session.iat * 1000).toISOString(),
      stepUpCreated: stepUp ? new Date(stepUp.iat * 1000).toISOString() : null,
    },
    'sam.auth.session',
    startedAt,
    estate.tick,
  );
}
