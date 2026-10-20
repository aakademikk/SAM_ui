/**
 * POST /api/chat/agent — start an agent turn.
 *
 * Chat runs the real Claude Code CLI as a server-side job rather than proxying
 * an LLM directly, so mobile gets the same file/bash/tool capability the
 * desktop has, with the job system's auth and audit trail already around it.
 *
 * Returns immediately with a job id and the chat id; output is consumed from
 * the existing /api/jobs/[id]/stream SSE endpoint.
 *
 * Step-up (biometric) auth is required — this can write files and run
 * commands, so it sits at the same level as POST /api/jobs.
 *
 * The route is auth, then parse, then `startTurn` (src/lib/server/chat/
 * startTurn.ts, which holds every turn rule: chats, tiers, locks, spawn), then
 * the audit line and the envelope.
 *
 * T10 (audit B-01/B-03): a body with `autoHandoff: true` (the chat page's
 * own sends) lets `startTurn` hand a Max or Max 2 chat at 400k context off
 * instead of running the message. The envelope then carries
 * `{ autoHandoff: true, memoJobId, chatId, tier }` and no `jobId`, so it can
 * never be streamed as if it were the reply. The step-up check above covers
 * this path too: it runs before anything else.
 */

// Loaded for its side effect too: handoff.ts registers the auto-handoff
// hooks startTurn's turn-start check calls (see `setAutoHandoff`).
import '@/lib/server/chat/handoff';
import { startTurn } from '@/lib/server/chat/startTurn';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';
import type { TierId } from '@/types/chat';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  const startedAt = Date.now();
  const estate = getEstate();

  const body = await readJson(request);

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const attachments = Array.isArray(body.attachments) ? (body.attachments as unknown[]) : [];

  // Unknown tier ids fall back to the cheap default rather than erroring.
  const tier: TierId =
    body.tier === 'max' || body.tier === 'max2' || body.tier === 'pro' || body.tier === 'gemini'
      ? body.tier
      : 'fast';

  // `chatId` names an existing chat; absent means a new one. `resumeSessionId`
  // is the pre-multi-chat field — accepted so a cached old client keeps
  // working (a chat id IS its CLI session id).
  const rawChatId =
    typeof body.chatId === 'string' && body.chatId
      ? body.chatId
      : typeof body.resumeSessionId === 'string' && body.resumeSessionId
        ? body.resumeSessionId
        : undefined;

  const result = await startTurn({
    message,
    attachments,
    tier,
    chatId: rawChatId,
    device: stepUp.device,
    // Only a client that can follow a handoff asks for one (the dashboard
    // widget does not; spec Won't do).
    autoHandoff: body.autoHandoff === true,
  });
  if (!result.ok) return failure(result.error, result.status);

  const fileCount = `${result.attachmentCount} file${result.attachmentCount === 1 ? '' : 's'}`;
  await logCommand({
    jobId: result.jobId,
    command: `[chat:${result.tier}${result.autoHandoff ? ' auto-handoff' : ''}] ${message.slice(0, 200)}${
      result.attachmentCount ? ` (+${fileCount})` : ''
    }`,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  if (result.autoHandoff) {
    return envelope(
      { autoHandoff: true, memoJobId: result.memoJobId, chatId: result.chatId, tier: result.tierInfo },
      'sam.chat.agent',
      startedAt,
      estate.tick,
    );
  }

  return envelope(
    { jobId: result.jobId, chatId: result.chatId, tier: result.tierInfo },
    'sam.chat.agent',
    startedAt,
    estate.tick,
  );
}
