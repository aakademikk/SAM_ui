/**
 * POST /api/practice/turn — one turn of a voice roleplay.
 *
 * The practice agent is a *configuration* of the same Claude Code CLI the chat
 * route runs, not a second implementation: same job manager, same SSE stream,
 * same session files on disk. What differs is the isolation —
 *
 *   --tools ""                 no tools at all
 *   --setting-sources project  the practice project's CLAUDE.md, not SAM's
 *   --strict-mcp-config        no MCP servers, even if a config names some
 *   --system-prompt <contract> the roleplay discipline, not the claude_code preset
 *
 * — and that isolation is why this is a separate route rather than a mode
 * inside chat. The chat route keeps one message thread and registers every
 * session it owns; a roleplay turn sent through it would put the buyer's lines
 * into SAM's history and let a roleplay session later be resumed as SAM. The
 * two session registries never overlap, so that cannot happen.
 *
 * The `claude_code` system prompt preset is replaced rather than appended to,
 * because it introduces "you are a coding agent", which fights the character.
 *
 * Auth is requireSession, NOT requireStepUp like /api/chat/agent. The
 * deviation is defensible only because of `--tools ""`: with nothing to act
 * with, the turn cannot touch anything, and a rehearsal that demanded a
 * biometric prompt between every spoken line would not get used. If a tool is
 * ever enabled here, this becomes requireStepUp in the same change.
 *
 * Body: { brief: string }                       open a session — load the brief
 *       { sessionId, message, brief? }          continue one
 * Returns { jobId, sessionId, speaker, openingLine }, and the turn streams from
 * /api/jobs/[id]/stream like any other job.
 */

import { randomUUID } from 'node:crypto';

import { claudeBin } from '@/lib/server/claudeBin';
import { getJobManager } from '@/lib/server/jobs/manager';
import { envelope, failure, readJson } from '@/lib/server/respond';
import { getEstate } from '@/lib/server/telemetry';
import { requireSession } from '@/lib/server/auth/guard';
import { logCommand } from '@/lib/server/auth/auditLog';
import { tierEnv } from '@/lib/server/chat/tiers';
import {
  acquireSessionLock,
  holdSessionLock,
  releaseSessionLock,
} from '@/lib/server/chat/sessionLock';
import { PRACTICE_ROOT, loadPrompt, readBrief, readDiscipline } from '@/lib/server/practice/briefs';
import { isPracticeSession, registerPracticeSession } from '@/lib/server/practice/sessions';

export const dynamic = 'force-dynamic';

/** Spoken turns are a sentence or two; this bounds the argv with room to spare. */
const MAX_MESSAGE_CHARS = 4000;

/** Session ids are CLI-generated UUIDs; refuse anything that isn't one. */
function validSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** A brief id, for the job label only. Never used as a path here. */
function validBriefId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;

  const startedAt = Date.now();
  const estate = getEstate();
  const body = await readJson(request);

  // Only sessions this route created may be resumed. A foreign id — most
  // importantly a SAM_ui chat session — falls through to a fresh practice
  // session rather than being handed to `--resume`.
  const resuming =
    validSessionId(body.sessionId) && isPracticeSession(body.sessionId)
      ? body.sessionId
      : null;

  const briefId = validBriefId(body.brief) ? body.brief : 'unknown';

  let message: string;
  let speaker = '';
  let openingLine = '';

  if (resuming) {
    const raw = typeof body.message === 'string' ? body.message.trim() : '';
    if (!raw) return failure('message is required.', 400);
    if (raw.length > MAX_MESSAGE_CHARS) {
      return failure(`Message too long (max ${MAX_MESSAGE_CHARS} chars).`, 413);
    }
    message = raw;
  } else {
    // Opening a session = the first message IS the brief. The character comes
    // entirely from the file, so there is nothing else to send it.
    const loaded = readBrief(typeof body.brief === 'string' ? body.brief : '');
    if (!loaded) return failure('Unknown brief.', 404);
    if (!loaded.brief.openingLine) {
      return failure(`Brief '${loaded.brief.id}' has no ## Opening line — refusing to start.`, 422);
    }
    speaker = loaded.brief.speaker;
    openingLine = loaded.brief.openingLine;
    message = loadPrompt(loaded.text);
  }

  let discipline: string;
  try {
    discipline = readDiscipline();
  } catch {
    return failure(
      'ROLEPLAY_DISCIPLINE.md is unreadable in the practice project — refusing to start ' +
        'a session without the character contract.',
      503,
    );
  }

  const args = [
    '-p',
    message,
    '--output-format',
    'stream-json',
    // stream-json only emits the full event set in verbose mode.
    '--verbose',
    // Token deltas, so the phone can speak the first sentence of the reply
    // while the rest is still being written. Without it the CLI emits one
    // complete message per turn and there is nothing to say until the whole
    // reply has landed. The desktop practice agent sets the same option
    // (voice-line/brain.py `include_partial_messages`), so both channels
    // stream a turn the same way.
    '--include-partial-messages',
    // The roleplay contract replaces the default system prompt.
    '--system-prompt',
    discipline,
    // No tools. A rehearsal partner that can read files, run bash or search
    // the web stops being a rehearsal and starts being a research task.
    '--tools',
    '',
    // Project settings only: the practice project's own CLAUDE.md. The user
    // level file is what makes SAM sound like SAM, and the character must not
    // inherit an assistant's idea of helpfulness.
    '--setting-sources',
    'project',
    '--strict-mcp-config',
  ];

  // A session is one file on disk that two concurrent `--resume` processes
  // would fight over, so the live turn holds it. Fresh sessions are locked too
  // — cheaper than reasoning about whether the client really waited for the
  // brief-load to finish before sending the first line.
  const sessionId = resuming ?? randomUUID();
  const acquired = acquireSessionLock(sessionId, session.device);
  if (!acquired.ok) {
    return failure(
      `This rehearsal is already running on '${acquired.device}'. ` +
        'Let it finish there, or stop it from that device.',
      409,
    );
  }

  if (resuming) {
    args.push('--resume', sessionId);
  } else {
    registerPracticeSession(sessionId);
    args.push('--session-id', sessionId);
  }

  const job = await getJobManager()
    .createArgs(claudeBin(), args, {
      // Display-only label. Never executed, and deliberately not the full argv:
      // the brief body is thousands of characters and the operator's own line
      // is private — neither belongs in the job list or the audit log.
      label: resuming
        ? `practice (${briefId}) — ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`
        : `practice (${briefId}) — loading brief`,
      cwd: PRACTICE_ROOT,
      env: {
        // Gemini, via the local Anthropic-compatible proxy, NOT the Claude Max
        // tier this route originally used. A rehearsal that dies the moment the
        // Claude subscription hits its session limit is not a rehearsal tool —
        // it fails exactly when there is time to practise. Gemini has no such
        // ceiling, and Flash holds the character (it pushed back, asked the
        // awkward question back, never broke into assistant voice).
        //
        // A constant, not a per-request choice, and that is deliberate: the tier
        // is then fixed for the life of a session by construction, so a resumed
        // turn can never answer as a different character than the one the
        // session opened with. To change the model, set SAM_GEMINI_MODEL — the
        // proxy already handles the 3.x family.
        ...tierEnv('gemini'),
        // The SessionStart hook launches the visualiser and a voice-line
        // terminal tab — wanted when Colin opens a session at his desk, not
        // when his phone starts a rehearsal.
        SAM_SKIP_SERVICE_LAUNCH: '1',
      },
      onExit: async () => {
        releaseSessionLock(sessionId);
      },
    })
    .catch((err: unknown) => {
      // The lock was taken before the spawn; release it rather than wedging
      // the session on a turn that never ran.
      releaseSessionLock(sessionId);
      throw err;
    });

  holdSessionLock(sessionId, job.id);

  await logCommand({
    jobId: job.id,
    command: `[practice:${briefId}] ${resuming ? message.slice(0, 200) : 'load brief'}`,
    device: session.device,
    credentialId: session.sub.slice(0, 12),
    timestamp: new Date().toISOString(),
  });

  return envelope(
    { jobId: job.id, sessionId, speaker, openingLine, brief: briefId },
    'sam.practice.turn',
    startedAt,
    estate.tick,
  );
}
