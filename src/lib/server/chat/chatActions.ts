/**
 * SAM — Chats API logic: list, open, archive, restore, delete, adopt.
 *
 * Phone and PC must see the same list and the same history for every chat
 * (spec must-do 4, 5), so every read here comes straight from the server's
 * own records (`chatStore.ts`, `transcripts.ts`) and takes no device input —
 * two callers asking the same question get the same answer. Every route that
 * calls into this file stays thin: auth, then one of these functions, then
 * `envelope`/`failure` (src/lib/server/respond.ts). None of this imports
 * `next/server`, so it stays testable with plain `node --test`, the same
 * reasoning `startTurn.ts` documents for itself.
 *
 * Archive and delete are refused with 409 while a turn is running in that
 * chat (spec must-do 12) — `isSessionLocked` (T5) is the single source of
 * truth for "is this chat running?", the same check the list's `running`
 * flag uses.
 */

import { getJobManager } from '@/lib/server/jobs/manager';
import type { ChatAccount, ChatMessage, ChatRecord, ChatSummary, ChatTier } from '@/types/chat';

import { importRegistryChats } from './importRegistry';
import { isSamuiSession } from './samuiSessions';
import { isSessionLocked } from './sessionLock';
import {
  archiveChat,
  createChat,
  deleteChat,
  getChat,
  getImportedAt,
  hasChatRecord,
  listChats,
  restoreChat,
  setRunningJob,
} from './chatStore';
import { fallbackTitle } from './titles';
import { firstUserMessage, inferTier, readHistory, transcriptPath, turnStartTimestamps } from './transcripts';

/** Pulls the human-readable text back out of a turn's job label
 *  (`sam-agent (<tier label>) — <text>`, set by `startTurn.ts`), for showing
 *  the in-flight prompt above its still-streaming answer on reattach (review
 *  finding 7). Falls back to the whole label on a shape it doesn't
 *  recognise — an internal (handoff memo) turn's label, say — rather than
 *  showing nothing. */
function promptFromJobLabel(label: string): string {
  const match = /^sam-agent \([^)]*\) — ([\s\S]*)$/.exec(label);
  return match ? match[1] : label;
}

/* ========================================================================== */
/* List                                                                       */
/* ========================================================================== */

export interface ListChatSummariesOptions {
  archived?: boolean;
  q?: string;
}

function toSummary(chat: ChatRecord): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    tier: chat.tier,
    account: chat.account,
    createdAt: chat.createdAt,
    lastActiveAt: chat.lastActiveAt,
    turns: chat.turns,
    archived: chat.archived,
    imported: chat.imported,
    handedOffTo: chat.handedOffTo,
    handedOffFrom: chat.handedOffFrom,
    handoffError: chat.handoffError,
    running: isSessionLocked(chat.id),
  };
}

/** `listChats` plus `running`, which is never stored — it is read fresh from
 *  the session lock every call, so two devices polling at different moments
 *  never disagree about whether a turn is in flight.
 *
 *  T8's registry import (178 chats, one-shot, spec 14a) runs here, once: the
 *  first time anyone lists chats with `importedAt` still unset. Every call
 *  after that finds `importedAt` set and skips straight to the list, so the
 *  import cannot repeat itself even across a restart. */
export function listChatSummaries(options: ListChatSummariesOptions = {}): ChatSummary[] {
  if (getImportedAt() === undefined) importRegistryChats();
  return listChats(options).map(toSummary);
}

/* ========================================================================== */
/* Open                                                                       */
/* ========================================================================== */

export interface OpenChatResult {
  chat: ChatRecord;
  messages: ChatMessage[];
  runningJobId: string | null;
  /** The in-flight turn's prompt text, set whenever a turn is running
   *  (`runningJobId` is non-null) and its job is still found live — lets the
   *  client show the question above the streaming placeholder instead of
   *  just the placeholder alone (review finding 7). */
  pendingPrompt?: string;
}

/**
 * `null` for an unknown or deleted chat — the route turns that into a 404.
 *
 * While a turn is running, the transcript MAY already hold the in-flight
 * turn's prompt (the CLI writes it the moment a turn starts, well before any
 * reply exists) — but only once it has actually been written: a chat opened
 * in the first second or so after spawn still shows only its previous,
 * finished turns. The trailing pair is dropped here only when its own prompt
 * entry timestamp is at or after the running job's `startedAt`, i.e. it
 * really is this turn and not an earlier finished one (review finding 7 —
 * blindly dropping the last two messages used to hide the wrong turn in that
 * window). Dropping the right pair is still necessary: the client replays
 * that exact turn live from the job stream (`runningJobId`), so serving it
 * here too would show it twice — once frozen mid-build, once live.
 */
export function openChat(id: string): OpenChatResult | null {
  let chat = getChat(id);
  if (!chat) return null;

  // `runningJobId` is persisted and cleared only by the job's own onExit —
  // a sam-ui restart mid-turn (deploy, crash) never runs that hook, so the
  // field can outlive the job. The in-memory session lock dies with the
  // process, so it is the only live signal of "still running" (the same one
  // the list's `running` flag reads); trust the stored field only while that
  // lock is actually held, and clear it otherwise, so a restart does not
  // hide the last exchange or hand every device a dead job id (review
  // finding 3, 2026-10-01).
  if (chat.runningJobId && !isSessionLocked(id)) {
    chat = setRunningJob(id, null) ?? chat;
  }

  let messages = readHistory(id);
  let pendingPrompt: string | undefined;

  if (chat.runningJobId) {
    const job = getJobManager().liveRecord(chat.runningJobId);
    const startedAtMs = job?.startedAt ? Date.parse(job.startedAt) : null;
    // Every pair whose prompt landed at or after the job's own start belongs
    // to this job: the turn's own prompt plus, on a Max turn, each late side
    // message (a prompt-shaped `user` entry, only tagged at turn exit, so
    // `readHistory` still returns it as its own pair). The live replay shows
    // all of them, so all of them are dropped here. A job we can no longer
    // find live should not happen while the lock is held, but falls back to
    // the old blunt rule (drop one pair) rather than risk a duplicate turn.
    let inFlightPairs = 0;
    if (startedAtMs !== null) {
      for (const start of turnStartTimestamps(id)) {
        if (start !== undefined && Date.parse(start) >= startedAtMs) inFlightPairs += 1;
      }
    } else if (job === null) {
      inFlightPairs = 1;
    }

    const drop = Math.min(2 * inFlightPairs, messages.length);
    if (drop > 0) {
      messages = messages.slice(0, messages.length - drop);
    }
    if (job) pendingPrompt = promptFromJobLabel(job.command);
  }

  return { chat, messages, runningJobId: chat.runningJobId, pendingPrompt };
}

/* ========================================================================== */
/* Archive / restore / delete                                                */
/* ========================================================================== */

export type ChatActionOutcome =
  | { ok: true; chat: ChatRecord }
  | { ok: false; status: number; error: string };

function actionFail(status: number, error: string): ChatActionOutcome {
  return { ok: false, status, error };
}

/** Shared guard for the three mutating actions below: the chat must exist
 *  (not deleted) and must not have a turn running (spec must-do 12). Returns
 *  the failure to return, or null to proceed. */
function guardNotRunning(id: string): ChatActionOutcome | null {
  if (!getChat(id)) return actionFail(404, 'Chat not found.');
  if (isSessionLocked(id)) return actionFail(409, 'A turn is running in this chat.');
  return null;
}

export function archive(id: string): ChatActionOutcome {
  const blocked = guardNotRunning(id);
  if (blocked) return blocked;
  const chat = archiveChat(id);
  if (!chat) return actionFail(404, 'Chat not found.');
  return { ok: true, chat };
}

export function restore(id: string): ChatActionOutcome {
  const blocked = guardNotRunning(id);
  if (blocked) return blocked;
  const chat = restoreChat(id);
  if (!chat) return actionFail(404, 'Chat not found.');
  return { ok: true, chat };
}

/** Sets the `deleted` flag only — `chatStore.deleteChat` never touches the
 *  transcript file, so it stays on disk for SAM to recover on request. */
export function remove(id: string): ChatActionOutcome {
  const blocked = guardNotRunning(id);
  if (blocked) return blocked;
  const chat = deleteChat(id);
  if (!chat) return actionFail(404, 'Chat not found.');
  return { ok: true, chat };
}

/* ========================================================================== */
/* Adopt                                                                      */
/* ========================================================================== */

/**
 * T14's migration of a device's current chat into the store, T8's use after
 * restoring an imported chat, and (review finding 14) `startTurn.ts`'s
 * pre-upgrade bridge — a resume whose id has no store record yet calls this
 * directly rather than keeping its own copy of the same "is this an id
 * SAM_ui owns, with a transcript still on disk?" logic. Allowed only for an
 * id SAM_ui itself created (`isSamuiSession`) that still has a transcript on
 * disk, so an id nothing here ever heard of is never resumed or listed.
 * Creates the store record if one does not exist yet (tier and account from
 * `inferTier`, fallback title from the first user message); if a record
 * already exists, it is only ever restored, never recreated — harmless when
 * called from a path (like startTurn's) that already knows no record exists.
 * Either way the chat always ends up unarchived — that is the point of
 * adopting it. A deleted chat (a record exists, but `getChat` hides it) is
 * not resurrected by adopt, same as it is not by a resumed turn.
 */
export function adopt(id: string): ChatActionOutcome {
  if (!isSamuiSession(id)) return actionFail(404, 'Chat not found.');
  const location = transcriptPath(id);
  if (!location) return actionFail(404, 'Chat not found.');

  const existing = getChat(id);
  if (existing) {
    const chat = existing.archived ? restoreChat(id) ?? existing : existing;
    return { ok: true, chat };
  }

  // A record exists but getChat hid it — it is deleted. Do not resurrect it.
  if (hasChatRecord(id)) return actionFail(404, 'Chat not found.');

  const inferred: { tier: ChatTier; account: ChatAccount } | null = inferTier(id);
  if (!inferred) return actionFail(404, 'Chat not found.');

  const first = firstUserMessage(id);
  const chat = createChat({
    id,
    tier: inferred.tier,
    account: inferred.account,
    firstMessage: first,
    title: fallbackTitle(first),
    titleSource: 'fallback',
    archived: false,
  });
  return { ok: true, chat };
}
