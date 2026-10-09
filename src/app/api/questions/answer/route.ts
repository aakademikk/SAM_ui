/**
 * POST /api/questions/answer  { jobId, questionId, answer: 'a' | 'b' }
 *
 * Order: same-origin (403), session (401), validate (400/404, nothing
 * changed), step-up when the question record says gated (401 stepUpRequired),
 * then run closer_answer.py. Returns only questionId, state, changed, result.
 */

import { checkAnswer, runAnswer, viaFromHeader } from '@/lib/server/questions/answer';
import { requireSession, requireStepUp } from '@/lib/server/auth/guard';
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
  const checked = checkAnswer(await readJson(request));
  if (!checked.ok) return failure(checked.error, checked.status);

  if (checked.gated) {
    const stepUp = await requireStepUp(request);
    if (stepUp instanceof Response) return stepUp;
  }

  const via = viaFromHeader(request.headers.get('x-answer-via'));
  const outcome = await runAnswer(checked.request, via);
  if (!outcome.ok) {
    return outcome.kind === 'invalid' ? failure('unknown question', 404) : failure('answer failed', 500);
  }
  return envelope(outcome.result, 'sam.questions.answer', startedAt, getEstate().tick);
}
