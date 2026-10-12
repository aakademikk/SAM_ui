/**
 * GET /api/questions  → the questions the job closer has put to Colin
 * (session required). A read only; answering is the POST route.
 */

import { readQuestions } from '@/lib/server/questions/questions';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  return envelope(readQuestions(), 'sam.questions.list', startedAt, estate.tick);
}
