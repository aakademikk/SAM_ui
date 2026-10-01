/**
 * POST /api/chats/[id]/handoff  → { tier } (step-up required)
 *
 * Hands the chat off to a new chat on `tier` (spec must-do 9b; the same tier
 * is allowed). Returns `{ memoJobId }` at once: the old chat's memo turn is
 * running, and the client follows it on /api/jobs/[id]/stream, then opens the
 * old chat's `handedOffTo` once it is set. Refused with 409 while a turn runs
 * in this chat or a handoff is already pending for it — `handoff.ts` holds
 * every rule; this route is auth, parse, call, audit line, envelope.
 */

import { startHandoff } from '@/lib/server/chat/handoff';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';
import type { TierId } from '@/types/chat';

export const dynamic = 'force-dynamic';

const TIERS: readonly TierId[] = ['fast', 'pro', 'max', 'max2', 'gemini'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  const startedAt = Date.now();
  const estate = getEstate();
  const { id } = await params;
  const body = await readJson(request);

  // Unlike a turn, a handoff's tier is a deliberate pick, so an unknown one is
  // an error rather than a fallback to the cheap default.
  const tier = TIERS.find((t) => t === body.tier);
  if (!tier) return failure(`tier must be one of ${TIERS.join(', ')}.`, 400);

  const result = await startHandoff(id, tier, stepUp.device);
  if (!result.ok) return failure(result.error, result.status);

  await logCommand({
    jobId: result.memoJobId,
    command: `[chat:handoff→${tier}] ${id}`,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  return envelope({ memoJobId: result.memoJobId }, 'sam.chats.handoff', startedAt, estate.tick);
}
