/**
 * SAM — start one chat turn.
 *
 * The body of `POST /api/chat/agent`, lifted out of the route so it can be
 * tested with plain `node --test` and called by other server code (T18's
 * handoff starts turns itself). The route keeps auth (`requireStepUp`), body
 * parsing, the audit log and the response envelope; everything from "is this
 * a valid turn?" to "the job is running" lives here. Deliberately no
 * `next/server` and no telemetry import, so this module loads outside Next.
 *
 * Rules (spec must-do 6, 9, 13, 14a):
 *   - No `chatId` → a new chat: a server-assigned UUID, registered as a
 *     SAM_ui session, a store record created, and `--session-id <id>`.
 *   - A `chatId` → the chat must exist in the store (not deleted), else 404.
 *     Its tier is fixed: a request on a different tier is refused with 409
 *     (Handoff is the only way to change tier). An `unknown`-tier chat
 *     (imported, mixed models) ignores the requested tier and runs on
 *     `max` (account main) or `max2` (account max2).
 *   - Every turn, new or resumed, takes the chat's session lock before
 *     spawning, so "is this chat running?" is always answerable
 *     (`isSessionLocked`) and a second turn in the same chat gets 409.
 *   - `SAM_CHAT_ID` rides in the CLI's env, so the chat's own Bash commands
 *     (and the jobs they dispatch, T11) know which chat they belong to.
 */

import { randomUUID } from 'node:crypto';

import { claudeBin } from '@/lib/server/claudeBin';
import { getJobManager } from '@/lib/server/jobs/manager';
import { reportChatRun } from '@/lib/server/fleet/costLedger';
import { MAX_ATTACHMENTS, attachmentBlock, resolveAttachment } from '@/lib/server/uploads';
import type { ChatRecord, TierId, TierInfo } from '@/types/chat';
import type { JobRecord } from '@/types/jobs';

import { adopt } from './chatActions';
import { agentCwd } from './agentCwd';
import { createChat, deleteChat, getChat, setRunningJob, touchChat } from './chatStore';
import { registerSamuiSession } from './samuiSessions';
import { acquireSessionLock, holdSessionLock, releaseSessionLock } from './sessionLock';
import { deepseekTierAvailable, geminiTierAvailable, tierEnv, tierInfo } from './tiers';
import { fallbackTitle, queueTitle } from './titles';
import { pingOffScreenChat } from './turnPing';

export const MAX_MESSAGE_CHARS = 8000;

/* ========================================================================== */
/* Exit hooks                                                                 */
/* ========================================================================== */

export interface TurnExitEvent {
  chatId: string;
  jobId: string;
  exitCode: number | null;
  /** The tier the turn actually ran on. */
  tier: TierId;
  /** True for a turn the server started for itself (T18's handoff memo turn),
   *  which must not ping (T10). */
  internal: boolean;
  /** The finished job's record. */
  record: JobRecord;
  /** The chat's store record after this turn's bookkeeping (running cleared,
   *  `lastActiveAt` and `turns` bumped). Null only if the chat vanished. */
  chat: ChatRecord | null;
}

export type TurnExitHook = (event: TurnExitEvent) => void | Promise<void>;

/**
 * Called after every turn exits, once the chat's lock is released and its
 * record updated. T7 (titles), T10 (pings) and T18 (handoff) push onto this
 * rather than editing the turn flow. Each hook runs in its own try/catch, in
 * order: one failing hook never stops another, and never affects the lock.
 */
export const onTurnExit: TurnExitHook[] = [];

/**
 * T7: queue a Haiku title once a turn ends, unless the chat already has one
 * or has failed enough tries. Fire-and-forget — `queueTitle` spawns the
 * title CLI call directly (it is not a user job) and this hook does not
 * await it, so a slow or hung title call can never delay another exit hook
 * (T10's ping, T18's handoff) or the next turn on this chat, whose lock is
 * already released by the time hooks run.
 */
onTurnExit.push((event) => {
  const chat = event.chat;
  if (!chat) return;
  // A handoff child is named after its parent (T18) and keeps that name. It
  // is the same conversation carried on, so a title generated from its own
  // first message — which is only "continue from the memo at ..." — would be
  // strictly worse than the name it already has. Colin's ask, 2026-10-03.
  if (chat.handedOffFrom) return;
  if (chat.titleSource === 'haiku') return;
  if (chat.titleTries >= 3) return;
  void queueTitle(event.chatId);
});

/**
 * T10: ping Colin when the chat that just finished was not on screen
 * anywhere (spec must-do 7a, 15). Awaited like every exit hook (see
 * `runExitHooks`) so a failure here is caught and logged rather than
 * escaping into the job's own exit handling, but the ping itself is fired
 * detached — this never delays the next turn.
 */
onTurnExit.push(pingOffScreenChat);

async function runExitHooks(event: TurnExitEvent): Promise<void> {
  for (const hook of onTurnExit) {
    try {
      await hook(event);
    } catch (err) {
      console.error('[chat] onTurnExit hook failed:', err);
    }
  }
}

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

/** Session ids are CLI-generated UUIDs; refuse anything that isn't one. */
export function validSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Pre-upgrade chat adoption (bridge until T14 + T6's `adopt` land).
 *
 * Before multi-chat, a device's one conversation lived only in localStorage
 * (`sam-agent-session`) plus the session registry — it has no chat-store
 * record. The page sends that id as `chatId`, so without this every existing
 * device chat would 404 until T14 adopts it. Review finding 14: this used to
 * be its own copy of "is this an id SAM_ui owns, with a transcript still on
 * disk?" plus the same `createChat` call `chatActions.ts`'s `adopt` already
 * makes; it now just calls `adopt` directly. Safe to call unconditionally
 * here (the caller below only reaches this once `getChat(id)` has already
 * returned null) — `adopt`'s "restore an existing record" branch can never
 * trigger for an id with no record yet, so the result is identical to the
 * old bespoke version. Anything `adopt` 404s on stays a 404 here too — no
 * unknown id is ever resumed, and a deleted chat is never resurrected.
 */
function adoptPreUpgradeChat(id: string): ChatRecord | null {
  const result = adopt(id);
  return result.ok ? result.chat : null;
}

/* ========================================================================== */
/* startTurn                                                                  */
/* ========================================================================== */

export interface StartTurnInput {
  message: string;
  /** Raw, client-supplied attachment candidates; each is re-validated. */
  attachments?: unknown[];
  /** The tier asked for. Ignored for an `unknown`-tier chat; must match a
   *  known-tier chat's own tier. */
  tier: TierId;
  /** Absent for a new chat. */
  chatId?: string;
  /** Human-readable device name, from the step-up payload. Named in the 409
   *  when another device holds the chat. */
  device: string;
  /** A server-started turn (T18's handoff memo), passed to exit hooks. */
  internal?: boolean;
  /**
   * The name a NEW chat is created with. Absent → the first message, cut
   * short. Ignored for a resume, which keeps the name it already has. T18's
   * handoff passes the parent's name plus " (handoff)", so the child is
   * named for the conversation it continues rather than for the memo path it
   * happens to open with.
   */
  title?: string;
}

export type StartTurnResult =
  | {
      ok: true;
      jobId: string;
      chatId: string;
      /** The tier the turn runs on. */
      tier: TierId;
      tierInfo: TierInfo;
      /** Resolved attachments, for the route's audit line. */
      attachmentCount: number;
      /** True when this turn created the chat. */
      created: boolean;
    }
  | { ok: false; status: number; error: string };

function fail(status: number, error: string): StartTurnResult {
  return { ok: false, status, error };
}

export async function startTurn(input: StartTurnInput): Promise<StartTurnResult> {
  const message = input.message.trim();
  const rawAttachments = input.attachments ?? [];

  // A turn is either something said or something shown, so an empty message is
  // only an error when there is nothing attached to carry it.
  if (!message && rawAttachments.length === 0) {
    return fail(400, 'message is required.');
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return fail(413, `Message too long (max ${MAX_MESSAGE_CHARS} chars).`);
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return fail(413, `Too many attachments (max ${MAX_ATTACHMENTS}).`);
  }

  // Every path must resolve inside the uploads directory. Without this check
  // the field is an arbitrary-file read primitive: post `/home/col/.ssh/id_rsa`
  // and the agent reads it out. resolveAttachment also refuses anything that is
  // not an existing regular file, so a directory or a stale path fails here
  // rather than silently inside the agent, and it sanitises the display name
  // because that name is client-supplied and lands in the prompt.
  const attachments: { path: string; name: string }[] = [];
  for (const candidate of rawAttachments) {
    const attachment = resolveAttachment(candidate);
    if (!attachment) return fail(400, 'Attachment is not a file you uploaded.');
    attachments.push(attachment);
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

  /* ---- Which chat, and which tier ---------------------------------------- */

  // Only sessions SAM_ui itself created may be resumed. A foreign id — e.g. the
  // live interactive terminal session the phone once inherited — would spawn a
  // second `claude` process on a conversation another process already owns, and
  // the two race the same session file. A resumable chat is one in the chat
  // store (which only ever holds app-created ids, so it also covers chats the
  // 500-entry registry has trimmed, e.g. T8's imports) or, for the pre-upgrade
  // bridge, a registry id with a transcript. Anything else is a 404.
  let existing: ChatRecord | null = null;
  if (input.chatId !== undefined) {
    if (!validSessionId(input.chatId)) return fail(404, 'Chat not found.');
    existing = getChat(input.chatId) ?? adoptPreUpgradeChat(input.chatId);
    // Reaching here means `getChat(id)` is non-null (the adopt path creates the
    // record only for an `isSamuiSession` id), so the resume rule
    // `isSamuiSession(id) || getChat(id)` holds by construction.
    if (!existing) return fail(404, 'Chat not found.');
  }

  let tier: TierId;
  if (existing) {
    if (existing.tier === 'unknown') {
      // Mixed-model chat from before tiers were per chat: run on the Claude
      // login whose config dir holds the transcript.
      tier = existing.account === 'max2' ? 'max2' : 'max';
    } else {
      if (input.tier !== existing.tier) {
        return fail(
          409,
          `This chat is on ${tierInfo(existing.tier).label}. Use Handoff to change tier.`,
        );
      }
      tier = existing.tier;
    }
  } else {
    tier = input.tier;
  }

  if (tier !== 'max' && tier !== 'max2') {
    const label = tier === 'gemini' ? 'Gemini' : tier === 'pro' ? 'Pro' : 'Fast';
    const configured =
      tier === 'gemini' ? geminiTierAvailable() : deepseekTierAvailable();
    if (!configured) {
      return fail(
        503,
        `${label} tier is not configured. ` +
          (tier === 'gemini'
            ? 'Set GEMINI_API_KEY (with the gemini-proxy service running), or use the Max tier.'
            : 'Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, or use the Max tier.'),
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

  /* ---- Lock --------------------------------------------------------------- */

  // A session is a single file on disk that two concurrent CLI processes would
  // fight over, so every turn holds its chat's lock for its lifetime — a first
  // turn included, so "is this chat running?" always has an answer. A second
  // turn is refused until the first finishes or the lock goes stale, naming
  // the device that holds it.
  const chatId = existing ? existing.id : randomUUID();
  const acquired = acquireSessionLock(chatId, input.device);
  if (!acquired.ok) {
    return fail(
      409,
      `This conversation is already in use on '${acquired.device}'. ` +
        'Let it finish there, or stop it from that device.',
    );
  }

  const created = !existing;
  if (existing) {
    args.push('--resume', chatId);
  } else {
    // Fresh conversation. Assign the id server-side and remember it as ours.
    // Never let the client dictate a new chat's id.
    registerSamuiSession(chatId);
    createChat({
      id: chatId,
      tier,
      account: tier === 'max2' ? 'max2' : 'main',
      firstMessage: message,
      title: input.title ?? fallbackTitle(message),
      titleSource: 'fallback',
    });
    args.push('--session-id', chatId);
  }

  const info = tierInfo(tier);
  const internal = input.internal === true;
  let exited = false;

  let job: JobRecord;
  try {
    job = await getJobManager().createArgs(claudeBin(), args, {
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
        // Reaches the chat's Bash commands, so a job dispatched from this chat
        // knows which chat to ping (T11).
        SAM_CHAT_ID: chatId,
      },
      // The turn ends the moment the process closes: record it on the chat,
      // drop the lock so the next turn — from this device or another — can take
      // it immediately, run the exit hooks, then report the turn's third-party
      // spend to the estate ledger (a no-op for the max tiers).
      onExit: async (finished) => {
        exited = true;
        let chat: ChatRecord | null = null;
        try {
          const current = getChat(chatId);
          if (current && current.runningJobId === finished.id) setRunningJob(chatId, null);
          chat = touchChat(chatId, { incrementTurns: true });
        } catch (err) {
          console.error('[chat] turn bookkeeping failed:', err);
        } finally {
          releaseSessionLock(chatId);
        }
        await runExitHooks({
          chatId,
          jobId: finished.id,
          exitCode: finished.exitCode,
          tier,
          internal,
          record: finished,
          chat,
        });
        await reportChatRun(finished.id, tier, info.model);
      },
    });
  } catch (err) {
    // The lock was taken before the spawn; if the spawn itself fails, release
    // it rather than wedging the chat on a turn that never ran. A chat this
    // turn created has no transcript and never ran, so it is dropped from the
    // list (flag only — see deleteChat).
    releaseSessionLock(chatId);
    if (created) {
      try {
        deleteChat(chatId);
      } catch {
        // Best effort; an empty chat in the list is harmless.
      }
    }
    throw err;
  }

  // The job now exists — pin the lock to it and start its heartbeat, and mark
  // the chat running. A command that exits instantly may already have run
  // onExit; then neither is done, or they would outlive the turn.
  if (!exited) {
    holdSessionLock(chatId, job.id);
    setRunningJob(chatId, job.id);
  }

  return {
    ok: true,
    jobId: job.id,
    chatId,
    tier,
    tierInfo: info,
    attachmentCount: attachments.length,
    created,
  };
}
