/**
 * POST /api/pack/approve  { questionId }      GET /api/pack/approve?questionId=
 *
 * Colin's Approve for the Monday pack's discrepancy set. Order: same-origin
 * (403), session (401), validate (400), then run pack_approve.py (404 when the
 * set is unknown or stale, 500 on any other failure). Returns only questionId,
 * state, changed, result. GET is read-only: session, then questionId and state.
 */

import { QUESTION_ID, runApprove, runStatus } from '@/lib/server/pack/approve';
import { viaFromHeader } from '@/lib/server/questions/answer';
import { requireSession } from '@/lib/server/auth/guard';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  // No header = non-browser client, which the session check already rejects.
  return !site || site === 'same-origin';
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure('Cross-origin request refused.', 403);

  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const { questionId } = await readJson(request);
  if (typeof questionId !== 'string' || !QUESTION_ID.test(questionId)) return failure('bad questionId', 400);

  const via = viaFromHeader(request.headers.get('x-answer-via'));
  const outcome = await runApprove(questionId, via);
  if (!outcome.ok) {
    return outcome.kind === 'invalid' ? failure('unknown question', 404) : failure('approve failed', 500);
  }
  return envelope(outcome.result, 'sam.pack.approve', startedAt, getEstate().tick);
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const questionId = new URL(request.url).searchParams.get('questionId');
  if (questionId === null || !QUESTION_ID.test(questionId)) return failure('bad questionId', 400);

  const outcome = await runStatus(questionId);
  if (!outcome.ok) {
    return outcome.kind === 'invalid' ? failure('unknown question', 404) : failure('status failed', 500);
  }
  return envelope(outcome.result, 'sam.pack.approve', startedAt, getEstate().tick);
}
