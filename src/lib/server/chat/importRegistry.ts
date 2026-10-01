/**
 * SAM — imports the old session registry's chats into Archived (T8).
 *
 * Spec must-do 14a: every chat already in `~/.sam/samui-sessions.json`
 * (178 ids on 2026-09-30) whose transcript still exists is imported into
 * Archived, with its title and history, and can be restored. This file is
 * the one-shot import; `chatActions.ts`'s `listChatSummaries` runs it once,
 * the first time anyone lists chats after this ticket ships.
 *
 * Deliberately reads the registry file itself (mirroring the tiny bit of
 * parsing `samuiSessions.ts` already does for `isSamuiSession`) rather than
 * adding a new export to that module — this ticket's Files line does not
 * touch `samuiSessions.ts`, and every id this import cares about is already
 * in that registry by construction, so there is nothing to register back
 * into it.
 *
 * An imported chat arrives archived, with a fallback title (Haiku's title is
 * queued in the background, one call at a time — T7's `queueTitle` — so 178
 * imports never block on 178 CLI calls) and `imported: true`. Once a store
 * record exists for an id, that id is never touched again on a later import
 * — including one that has since been restored, adopted, or even deleted —
 * which is what makes running this on every cold start safe.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CreateChatInput } from './chatStore';
import { createChats, hasChatRecord } from './chatStore';
import { fallbackTitle, queueTitle } from './titles';
import { firstUserMessage, inferTier, transcriptPath } from './transcripts';

/** Same path `samuiSessions.ts` persists to. Resolved on every call (not
 *  cached), the same reasoning every other store path in this codebase
 *  follows: a test that points `HOME` at a fresh temp dir before importing
 *  must see that dir, not whatever was live when some earlier module loaded. */
function registryFile(): string {
  return path.join(os.homedir(), '.sam', 'samui-sessions.json');
}

/** Every id in the registry file, or `[]` if it is missing or corrupt — the
 *  same tolerant read every other on-disk store in this codebase uses. */
function registryIds(): string[] {
  try {
    const raw = fs.readFileSync(registryFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === 'string');
    }
  } catch {
    // No registry yet, or it is unreadable — nothing to import.
  }
  return [];
}

/** Raw shape of one transcript line, only as much as this file needs. */
interface RawEntry {
  timestamp?: unknown;
}

/**
 * `createdAt` (first entry's timestamp) and `lastActiveAt` (last entry's
 * timestamp) straight from the transcript file — `readHistory`'s
 * `ChatMessage`s carry no timestamp at all, so this reads the file directly
 * rather than asking `transcripts.ts` for something it does not expose.
 * Falls back to "now" for both if the file has no entry with a `timestamp`
 * string, which should not happen for a real transcript but must not crash
 * the import if it ever does.
 */
function transcriptTimestamps(filePath: string): { createdAt: string; lastActiveAt: string } {
  const raw = fs.readFileSync(filePath, 'utf8');
  const timestamps: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as RawEntry;
      if (typeof entry.timestamp === 'string') timestamps.push(entry.timestamp);
    } catch {
      // Corrupt or partial line — skip it, same as transcripts.ts's readEntries.
      continue;
    }
  }
  if (timestamps.length === 0) {
    const now = new Date().toISOString();
    return { createdAt: now, lastActiveAt: now };
  }
  return { createdAt: timestamps[0], lastActiveAt: timestamps[timestamps.length - 1] };
}

/**
 * Folds every registry id with a transcript, and no existing store record,
 * into the store as an archived, imported chat, then queues its Haiku title.
 * Idempotent: an id that already has a record (imported earlier, adopted,
 * restored, or even deleted) is left exactly as it is. Always records
 * `importedAt`, even when the registry is empty or missing, so a caller that
 * only checks "has this ever run" (`chatActions.ts`) never re-runs it.
 *
 * Builds every chat's `CreateChatInput` first and writes them — and
 * `importedAt` — in one `createChats` call, rather than the one-`persist()`-
 * per-chat `createChat` used to cost (review finding 10): 178 imports used to
 * mean 178 full-store rewrites, each blocking the event loop for the request
 * that triggered the import (the first `GET /api/chats` after deploy).
 */
export function importRegistryChats(): void {
  const inputs: CreateChatInput[] = [];

  for (const id of registryIds()) {
    if (hasChatRecord(id)) continue;

    const location = transcriptPath(id);
    if (!location) continue; // no transcript — spec 14a only imports ids that still have one

    const inferred = inferTier(id);
    if (!inferred) continue; // transcriptPath just found it, so this should not happen

    const firstMessage = firstUserMessage(id);
    const { createdAt, lastActiveAt } = transcriptTimestamps(location.path);

    inputs.push({
      id,
      tier: inferred.tier,
      account: inferred.account,
      firstMessage,
      title: fallbackTitle(firstMessage),
      titleSource: 'fallback',
      createdAt,
      lastActiveAt,
      archived: true,
      imported: true,
    });
  }

  const created = createChats(inputs, { importedAt: new Date().toISOString() });

  // Fire-and-forget, one at a time (titles.ts's own queue), and marked
  // `background` so a live chat's own title call — queued later, the moment
  // its first turn ends — jumps ahead of whatever import backlog is still
  // waiting (review finding 10): without that priority, a chat Colin starts
  // right after deploy kept its fallback title until all 178 imports' title
  // calls had drained, one Haiku call at a time.
  for (const chat of created) {
    void queueTitle(chat.id, { background: true });
  }
}
