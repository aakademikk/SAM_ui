/**
 * POST /api/chats/[id]/side  → { text } (step-up required)
 *
 * Delivers a side message into the chat's already-running turn (spec
 * must-do 2) rather than starting a second one — this writes into a running
 * agent, so it takes the same auth level as starting a turn
 * (`/api/chat/agent`) or writing to a job's stdin (`/api/jobs/[id]/input`).
 * `sendSideMessage` holds every rule (tier gating, the 409s); this route is
 * auth, parse, call, envelope.
 */

import { sendSideMessage } from '@/lib/server/chat/sideMessage';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireStepUp } from '@/lib/server/auth/guard';

export const dynamic = 'force-dynamic';

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

  const text = typeof body.text === 'string' ? body.text : '';
  const result = await sendSideMessage({ chatId: id, text, device: stepUp.device });
  if (!result.ok) return failure(result.error, result.status);

  return envelope({ sent: true }, 'sam.chats.side', startedAt, estate.tick);
}
