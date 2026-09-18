/**
 * GET /api/practice/briefs — the scenarios available to rehearse.
 *
 * Each brief carries its speaker and opening line, so the picker can show what
 * the rehearsal is and who is on the other side of it before it starts.
 *
 * Requires a session cookie, no step-up: this reads a directory of markdown
 * files and nothing else.
 */

import { requireSession } from '@/lib/server/auth/guard';
import { envelope } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { listBriefs } from '@/lib/server/practice/briefs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();

  return envelope(
    { briefs: listBriefs() },
    'sam.practice.briefs',
    startedAt,
    getEstate().tick,
  );
}
