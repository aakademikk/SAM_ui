/**
 * POST /api/chat/agent — start an agent turn.
 *
 * Chat runs the real Claude Code CLI as a server-side job rather than proxying
 * an LLM directly, so mobile gets the same file/bash/tool capability the
 * desktop has, with the job system's auth and audit trail already around it.
 *
 * Returns immediately with a job id; output is consumed from the existing
 * /api/jobs/[id]/stream SSE endpoint.
 *
 * Step-up (biometric) auth is required — this can write files and run
 * commands, so it sits at the same level as POST /api/jobs.
 */

import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { claudeBin } from '@/lib/server/claudeBin';
import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import {
  MAX_ATTACHMENTS,
  attachmentBlock,
  resolveUploadPath,
} from '@/lib/server/uploads';
import { requireStepUp } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';
import {
  tierEnv,
  tierInfo,
  deepseekTierAvailable,
  geminiTierAvailable,
} from '@/lib/server/chat/tiers';
import {
  acquireSessionLock,
  holdSessionLock,
  releaseSessionLock,
} from '@/lib/server/chat/sessionLock';
import {
  isSamuiSession,
  registerSamuiSession,
} from '@/lib/server/chat/samuiSessions';
import { reportChatRun } from '@/lib/server/fleet/costLedger';
import type { TierId } from '@/types/chat';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE_CHARS = 8000;

/** Where the agent runs. Its CLAUDE.md is what makes SAM sound like SAM. */
function agentCwd(): string {
  return process.env.SAM_AGENT_CWD ?? path.join(os.homedir(), 'claude');
}

/** Session ids are CLI-generated UUIDs; refuse anything that isn't one. */
function validSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export async function POST(request: Request) {
  const stepUp = await requireStepUp(request);
  if (stepUp instanceof Response) return stepUp;

  const startedAt = Date.now();
  const estate = getEstate();

  const body = await readJson(request);

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];

  // A turn is either something said or something shown, so an empty message is
  // only an error when there is nothing attached to carry it.
  if (!message && rawAttachments.length === 0) {
    return failure('message is required.', 400);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return failure(`Message too long (max ${MAX_MESSAGE_CHARS} chars).`, 413);
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return failure(`Too many attachments (max ${MAX_ATTACHMENTS}).`, 413);
  }

  // Every path must resolve inside the uploads directory. Without this check
  // the field is an arbitrary-file read primitive: post `/home/col/.ssh/id_rsa`
  // and the agent reads it out. resolveUploadPath also refuses anything that is
  // not an existing regular file, so a directory or a stale path fails here
  // rather than silently inside the agent.
  const attachments: { path: string; name: string }[] = [];
  for (const candidate of rawAttachments) {
    const resolved = resolveUploadPath(candidate);
    if (!resolved) return failure('Attachment is not a file you uploaded.', 400);
    attachments.push({ path: resolved, name: path.basename(resolved) });
  }

  // The paths ride with the message because that is the one channel the CLI
  // already understands. Appended after the length check, so a long attachment
  // list can never push Colin's own text over the cap.
  const prompt = message + attachmentBlock(attachments);

  // The job label is display-only, so it names the files rather than carrying
  // their paths — and an attachment-only turn still gets a label instead of a
  // blank one.
  const fileCount = `${attachments.length} file${attachments.length === 1 ? '' : 's'}`;
  const labelText = message
    ? `${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`
    : fileCount;

  // Unknown tier ids fall back to the cheap default rather than erroring.
  const tier: TierId =
    body.tier === 'max' || body.tier === 'max2' || body.tier === 'pro' || body.tier === 'gemini'
      ? body.tier
      : 'fast';
  if (tier !== 'max' && tier !== 'max2') {
    const label = tier === 'gemini' ? 'Gemini' : tier === 'pro' ? 'Pro' : 'Fast';
    const configured =
      tier === 'gemini' ? geminiTierAvailable() : deepseekTierAvailable();
    if (!configured) {
      return failure(
        `${label} tier is not configured. ` +
          (tier === 'gemini'
            ? 'Set GEMINI_API_KEY (with the gemini-proxy service running), or use the Max tier.'
            : 'Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, or use the Max tier.'),
        503,
      );
    }
  }

  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    // stream-json only emits the full event set in verbose mode.
    '--verbose',
  ];

  // A session is a single file on disk that two concurrent `--resume`
  // processes would fight over, so the holding turn keeps it locked for its
  // lifetime. A second resume attempt is refused until the turn finishes or
  // the lock goes stale, naming the device that holds it.
  //
  // Only sessions SAM_ui itself created may be resumed. A foreign id — e.g. the
  // live interactive terminal session the phone once inherited — would spawn a
  // second `claude` process on a conversation another process already owns, and
  // the two race the same session file (the mobile turn streams a duplicate of
  // the terminal's working and never lands an answer). Unknown ids fall back to
  // a fresh server-assigned session, registered so the next turn recognises it.
  const requestedResume =
    typeof body.resumeSessionId === 'string' &&
    validSessionId(body.resumeSessionId) &&
    isSamuiSession(body.resumeSessionId)
      ? body.resumeSessionId
      : null;

  let resumeSessionId: string | null = null;
  if (requestedResume) {
    const acquired = acquireSessionLock(requestedResume, stepUp.device);
    if (!acquired.ok) {
      return failure(
        `This conversation is already in use on '${acquired.device}'. ` +
          'Let it finish there, or stop it from that device.',
        409,
      );
    }
    resumeSessionId = requestedResume;
    args.push('--resume', resumeSessionId);
  } else {
    // Fresh conversation. Assign the id server-side and remember it as ours, so
    // the client's next turn (which resumes whatever the stream reports) is
    // recognised rather than refused. Never let the client dictate a foreign id.
    const sessionId = randomUUID();
    registerSamuiSession(sessionId);
    args.push('--session-id', sessionId);
  }

  const info = tierInfo(tier);

  const job = await getJobManager()
    .createArgs(claudeBin(), args, {
      // Display-only label. Never executed, and deliberately not the full argv:
      // the message text would otherwise land in the job list and audit log.
      label: `sam-agent (${info.label}) — ${labelText}`,
      cwd: agentCwd(),
      env: {
        ...tierEnv(tier),
        // The SessionStart hook launches the visualiser and a voice-line
        // terminal tab. That is desirable when Colin opens a session at his
        // desk, and decidedly not when a phone message spawns one. The service
        // inherits a live DISPLAY, so a GUI check would not catch this.
        SAM_SKIP_SERVICE_LAUNCH: '1',
      },
      // The turn ends the moment the process closes; drop the lock so the next
      // resume — from this device or another — can take it immediately. In the
      // same breath, report the turn's third-party spend to the estate ledger
      // (the same best-effort reporter the fleet dispatch route uses — a no-op
      // for the max tier and for Anthropic models).
      onExit: async (finished) => {
        if (resumeSessionId) releaseSessionLock(resumeSessionId);
        await reportChatRun(finished.id, tier, info.model);
      },
    })
    .catch((err: unknown) => {
      // The lock was taken before the spawn; if the spawn itself fails, release
      // it rather than wedging the session on a turn that never ran.
      if (resumeSessionId) releaseSessionLock(resumeSessionId);
      throw err;
    });

  // The job now exists — pin the lock to it and start its heartbeat.
  if (resumeSessionId) holdSessionLock(resumeSessionId, job.id);

  await logCommand({
    jobId: job.id,
    command: `[chat:${tier}] ${message.slice(0, 200)}${
      attachments.length ? ` (+${fileCount})` : ''
    }`,
    device: stepUp.device,
    credentialId: stepUp.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  return envelope(
    { jobId: job.id, tier: info },
    'sam.chat.agent',
    startedAt,
    estate.tick,
  );
}
