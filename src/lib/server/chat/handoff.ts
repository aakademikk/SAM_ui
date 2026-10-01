/**
 * SAM — hand a chat off to a new chat, on any tier.
 *
 * Spec must-do 9b; check 7b. Handoff is the only way to change tier (a
 * chat's tier is fixed by its first message, spec section 4); the same tier
 * is allowed too, for a fresh context. Two turns, chained:
 *
 *   1. A memo turn in the OLD chat, on its own tier, through `startTurn`
 *      marked `internal` (so T10 never pings about it). Its prompt names one
 *      exact file in the vault's `06 - Handoffs/` and tells SAM to write the
 *      memo there and nowhere else.
 *   2. This module's `onTurnExit` hook, once that turn exits: if the memo
 *      file exists, a NEW chat starts on the picked tier with a first message
 *      pointing at the memo, and the two chats are linked (`markHandedOff`).
 *      If it does not (the old chat's seat hit its limit, say), the old chat
 *      gets `handoffError` and nothing starts.
 *
 * A handoff is "pending" from the moment it is accepted until step 2 has
 * finished or failed. The memo turn holds the chat's session lock like any
 * turn, but the lock is released before exit hooks run, so the pending mark
 * is what refuses a second handoff (409) in the gap between the memo turn
 * exiting and the new chat starting. Pending state lives on `globalThis`,
 * for the same reason the chat store's cache does: every route handler must
 * see one copy.
 *
 * Nothing here writes to the vault itself — the memo is SAM's to write — and
 * nothing goes near `02 - Atwood Systems/` or the folder's index note.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TierId } from '@/types/chat';

import { clearHandoffState, getChat, markHandedOff, setHandoffError } from './chatStore';
import { isSessionLocked } from './sessionLock';
import { onTurnExit, startTurn, type TurnExitEvent } from './startTurn';

interface PendingHandoff {
  /** The tier the new chat starts on. */
  tier: TierId;
  /** The exact file the memo turn was told to write. */
  memoPath: string;
  /** The device that pressed Handoff; the new chat's turn runs as it. */
  device: string;
}

const globalForSam = globalThis as unknown as {
  __samuiPendingHandoffs?: Map<string, PendingHandoff>;
};

function pendingHandoffs(): Map<string, PendingHandoff> {
  if (!globalForSam.__samuiPendingHandoffs) globalForSam.__samuiPendingHandoffs = new Map();
  return globalForSam.__samuiPendingHandoffs;
}

/** True from the moment a handoff is accepted until its new chat has started
 *  (or the handoff has failed). */
export function isHandoffPending(chatId: string): boolean {
  return pendingHandoffs().has(chatId);
}

/* ========================================================================== */
/* Memo path                                                                  */
/* ========================================================================== */

function handoffsDir(): string {
  const vault = process.env.SAM_VAULT_DIR ?? path.join(os.homedir(), 'ai-memory-vault');
  return path.join(vault, '06 - Handoffs');
}

/** Local date, `YYYY-MM-DD`, matching the existing memo file names. */
function today(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The chat title with every character a file name cannot safely hold
 *  stripped, and whitespace (newlines included) collapsed. */
function fileSafeTitle(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || 'Chat';
}

/**
 * `<vault>/06 - Handoffs/<YYYY-MM-DD> <title> handoff.md`, with ` (2)`,
 * ` (3)`… added when that name is taken — on disk, or by another handoff
 * still pending (whose memo may not be written yet).
 */
export function memoPathFor(title: string, now = new Date()): string {
  const dir = handoffsDir();
  const base = `${today(now)} ${fileSafeTitle(title)} handoff`;
  const reserved = new Set([...pendingHandoffs().values()].map((p) => p.memoPath));
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, n === 1 ? `${base}.md` : `${base} (${n}).md`);
    if (!fs.existsSync(candidate) && !reserved.has(candidate)) return candidate;
  }
}

function memoPrompt(memoPath: string): string {
  return [
    'Handoff: this chat is being handed off to a new chat. Write a handoff memo for',
    'whoever picks this up cold. Name the next action, the open decisions, and the',
    'state of the work (what is done, what is in progress, the files involved).',
    '',
    `Write the memo to: ${memoPath}`,
    '',
    'Write that one file and nothing else: do not create or edit any other file,',
    'note or index. When it is written, reply with its path only.',
  ].join('\n');
}

/* ========================================================================== */
/* startHandoff                                                               */
/* ========================================================================== */

export type StartHandoffResult =
  | { ok: true; memoJobId: string }
  | { ok: false; status: number; error: string };

/**
 * Starts a handoff from `chatId` to a new chat on `tier`. Returns as soon as
 * the memo turn is running; the client follows that turn (`memoJobId`), then
 * opens the old chat's `handedOffTo` once it is set.
 */
export async function startHandoff(
  chatId: string,
  tier: TierId,
  device: string,
): Promise<StartHandoffResult> {
  const chat = getChat(chatId);
  if (!chat) return { ok: false, status: 404, error: 'Chat not found.' };
  if (isHandoffPending(chatId)) {
    return { ok: false, status: 409, error: 'A handoff is already in progress for this chat.' };
  }
  if (isSessionLocked(chatId)) {
    return { ok: false, status: 409, error: 'A turn is running in this chat.' };
  }

  // Clears the PREVIOUS attempt's outcome before this one does anything else
  // (review finding 6). Without this, a retry after a failed attempt — or a
  // second handoff on a chat already handed off once — lets a client that
  // starts watching `handoffWaitingFor` the moment this call resolves read
  // the old `handoffError`/`handedOffTo` and act on it as if it were this
  // attempt's result, before the new chain has gone anywhere near setting
  // either field for real.
  clearHandoffState(chatId);

  // Marked pending before the turn starts, so the path is reserved and a
  // second press is refused even before the lock is taken.
  const memoPath = memoPathFor(chat.title);
  const pending = pendingHandoffs();
  pending.set(chatId, { tier, memoPath, device });

  let result: Awaited<ReturnType<typeof startTurn>>;
  try {
    result = await startTurn({
      message: memoPrompt(memoPath),
      // The old chat's own tier. An `unknown`-tier chat ignores this and runs
      // on its account's Max seat (startTurn's rule).
      tier: chat.tier === 'unknown' ? 'max' : chat.tier,
      chatId,
      device,
      internal: true,
    });
  } catch (err) {
    pending.delete(chatId);
    throw err;
  }
  if (!result.ok) {
    pending.delete(chatId);
    return result;
  }
  return { ok: true, memoJobId: result.jobId };
}

/* ========================================================================== */
/* Exit hook: the second half of the chain                                    */
/* ========================================================================== */

async function continueHandoff(event: TurnExitEvent): Promise<void> {
  if (!event.internal) return;
  const pending = pendingHandoffs();
  const handoff = pending.get(event.chatId);
  if (!handoff) return;

  try {
    if (!fs.existsSync(handoff.memoPath)) {
      setHandoffError(
        event.chatId,
        `The handoff memo was not written (${handoff.memoPath}). Nothing was started.`,
      );
      return;
    }

    const next = await startTurn({
      message: `Continue from the handoff memo at ${handoff.memoPath}. Read it first.`,
      tier: handoff.tier,
      device: handoff.device,
    });
    if (!next.ok) {
      setHandoffError(event.chatId, `The new chat could not start: ${next.error}`);
      return;
    }
    markHandedOff(event.chatId, next.chatId);
  } catch (err) {
    setHandoffError(event.chatId, `The handoff failed: ${String(err)}`);
  } finally {
    pending.delete(event.chatId);
  }
}

// Attached here rather than in startTurn.ts (T5's `onTurnExit` exists for
// exactly this). Whatever imports `startHandoff` — the only way a handoff
// starts — loads this module, so the hook is always in place before a memo
// turn can exit.
onTurnExit.push(continueHandoff);
