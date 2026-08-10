/**
 * SAM — Auth guard helpers for API routes.
 *
 * Usage:
 *   const session = await requireSession(request);
 *   if (session instanceof Response) return session; // 401
 *
 *   const stepUp = await requireStepUp(request);
 *   if (stepUp instanceof Response) return stepUp; // 401
 */

import { verifySession, verifyStepUp, type SessionPayload } from './session';

/**
 * Returns the session payload if valid, or a 401 Response.
 * Use for read operations: view dashboards, logs, job status.
 */
export async function requireSession(
  request: Request,
): Promise<SessionPayload | Response> {
  const session = await verifySession(request.headers.get('cookie'));
  if (!session) {
    return Response.json(
      { error: 'Not authenticated. Log in first.' },
      { status: 401 },
    );
  }
  return session;
}

/**
 * Returns the step-up payload if valid, or a 401 Response.
 * Use for write operations: run commands, kill jobs, change settings.
 */
export async function requireStepUp(
  request: Request,
): Promise<SessionPayload | Response> {
  const stepUp = await verifyStepUp(request.headers.get('cookie'));
  if (!stepUp) {
    return Response.json(
      {
        error: 'Biometric step-up required. Call /api/auth/stepup first.',
        stepUpRequired: true,
      },
      { status: 401 },
    );
  }
  return stepUp;
}
