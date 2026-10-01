/**
 * SAM — the server's own record of every chat.
 *
 * `samuiSessions.ts` only ever answers "did SAM_ui create this session id?" —
 * it is the resume allowlist, and stays that way (this file does not touch
 * it). This store is the proper record the list, titles, tiers, archive and
 * delete need: one `ChatRecord` per chat, persisted to
 * `~/.sam/samui-chats.json`. Titles and any other chat text live in this
 * file, under `~/.sam` — never in the vault's `02 - Atwood Systems/`, which
 * has no idea SAM_ui's chats exist.
 *
 * Persistence follows the same pattern as `samuiSessions.ts` and
 * `auth/store.ts`: the path is resolved from `os.homedir()` on every load
 * (not cached at module load, so a test that sets `HOME` before importing —
 * or resets between fixtures — reads and writes the right file), the loaded
 * value is cached on `globalThis` so every route handler shares one copy
 * across module reloads, and every write is atomic (temp file, then
 * `rename`), so a crash mid-write cannot leave a truncated, unparseable
 * store that silently forgets every chat.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ChatAccount, ChatRecord, ChatTier } from '@/types/chat';

function storeFile(): string {
  return path.join(os.homedir(), '.sam', 'samui-chats.json');
}

/**
 * On-disk shape. `chats` is keyed by id (an object, not an array) so
 * `getChat`/`setTitle`/etc. are O(1) rather than a linear scan, and so two
 * chats can never collide under the same key by accident.
 *
 * `importedAt` is a store-level field (not per chat): T8's
 * `importRegistryChats()` sets it once the registry's ids have all been
 * folded in, so a restart does not re-run the import. `getImportedAt` /
 * `setImportedAt` exist here, ahead of T8, so that ticket needs only call
 * them rather than touch this file's shape.
 */
interface ChatStoreFile {
  version: 1;
  chats: Record<string, ChatRecord>;
  /** ISO-8601. Set once by `importRegistryChats` (T8). */
  importedAt?: string;
}

function emptyStore(): ChatStoreFile {
  return { version: 1, chats: {} };
}

const globalForSam = globalThis as unknown as { __samuiChatStore?: ChatStoreFile };

function load(): ChatStoreFile {
  const cached = globalForSam.__samuiChatStore;
  if (cached) return cached;

  let store = emptyStore();
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChatStoreFile> | null;
    if (parsed && typeof parsed === 'object' && parsed.chats && typeof parsed.chats === 'object') {
      store = {
        version: 1,
        chats: parsed.chats,
        importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : undefined,
      };
    }
  } catch {
    // First run, or a corrupt/missing file — start empty, same as
    // samuiSessions.ts and auth/store.ts.
  }
  globalForSam.__samuiChatStore = store;
  return store;
}

function persist(store: ChatStoreFile): void {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic: temp file in the same directory, then rename. Same reasoning as
  // samuiSessions.ts and auth/store.ts — a write interrupted mid-truncate
  // must not leave a corrupt file that load() silently treats as empty,
  // which here would mean every chat vanishing from the list.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

/** Test-only: drop the cached store so the next call re-reads from disk
 *  (or from a freshly pointed `HOME`). Mirrors the reset seam every other
 *  globalThis-cached store in this codebase needs for isolated tests. */
export function __resetChatStoreForTests(): void {
  delete globalForSam.__samuiChatStore;
}

/* ========================================================================== */
/* Store-level fields                                                         */
/* ========================================================================== */

/** ISO-8601, or undefined before the registry import (T8) has ever run. */
export function getImportedAt(): string | undefined {
  return load().importedAt;
}

export function setImportedAt(iso: string): void {
  const store = load();
  store.importedAt = iso;
  persist(store);
}

/* ========================================================================== */
/* CRUD                                                                        */
/* ========================================================================== */

export interface CreateChatInput {
  /** The Claude CLI session id this chat resumes. */
  id: string;
  tier: ChatTier;
  account: ChatAccount;
  /** Full first message; trimmed to 500 characters here. */
  firstMessage: string;
  /** Falls back to "New chat" — callers (startTurn, T7's fallbackTitle,
   *  T8's importRegistryChats) are expected to pass a real title; this only
   *  guards against an empty string reaching the list. */
  title?: string;
  titleSource?: 'fallback' | 'haiku';
  /** ISO-8601. Defaults to now. */
  createdAt?: string;
  /** ISO-8601. Defaults to `createdAt`. */
  lastActiveAt?: string;
  /** Defaults to false. T8's imports arrive archived. */
  archived?: boolean;
  /** Defaults to false. Set by T8's importRegistryChats. */
  imported?: boolean;
}

export function createChat(input: CreateChatInput): ChatRecord {
  const store = load();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const record: ChatRecord = {
    id: input.id,
    title: input.title && input.title.trim() ? input.title : 'New chat',
    titleSource: input.titleSource ?? 'fallback',
    titleTries: 0,
    tier: input.tier,
    account: input.account,
    firstMessage: input.firstMessage.slice(0, 500),
    createdAt,
    lastActiveAt: input.lastActiveAt ?? createdAt,
    turns: 0,
    archived: input.archived ?? false,
    deleted: false,
    imported: input.imported ?? false,
    runningJobId: null,
  };
  store.chats[record.id] = record;
  persist(store);
  return { ...record };
}

/** Null for an unknown id, and for a deleted chat — the flag stays on disk
 *  (deleteChat never erases the record) but callers must treat it as gone.
 *
 *  Returns a shallow copy, not the store's own object: every mutator below
 *  (`update`) writes through the cached store in place, so handing out the
 *  live reference would let a later `touchChat`/`setTitle`/etc. silently
 *  rewrite a record a caller is still holding from an earlier `getChat`. */
export function getChat(id: string): ChatRecord | null {
  const record = load().chats[id];
  if (!record || record.deleted) return null;
  return { ...record };
}

/** True when any record exists for `id`, deleted or not. `getChat` hides a
 *  deleted chat; this does not, so a caller that creates records on the fly
 *  (startTurn's pre-upgrade adopt, T6's `adopt`) can tell "never seen" from
 *  "deleted" and never resurrect a deleted chat by overwriting its record. */
export function hasChatRecord(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(load().chats, id);
}

export interface ListChatsOptions {
  /** Defaults to false: the main list. True for the Archived view. */
  archived?: boolean;
  /** Case-insensitive substring match on title only (see filterByTitle). */
  q?: string;
}

/** Newest `lastActiveAt` first. Always excludes deleted chats. Returns
 *  copies, for the same reason `getChat` does. */
export function listChats(options: ListChatsOptions = {}): ChatRecord[] {
  const wantArchived = options.archived ?? false;
  const all = Object.values(load().chats)
    .filter((chat) => !chat.deleted && chat.archived === wantArchived)
    .map((chat) => ({ ...chat }));
  const filtered = options.q ? filterByTitle(all, options.q) : all;
  return filtered.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

/** Case-insensitive substring match on `title` only — never `firstMessage`
 *  or any other field. Pure: takes and returns records, touches no store. */
export function filterByTitle<T extends { title: string }>(chats: T[], q: string): T[] {
  const needle = q.toLowerCase();
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle));
}

/** Mutates the store's own record in place, persists, and returns a copy
 *  (never the live object — see the note on `getChat`). */
function update(id: string, mutate: (record: ChatRecord) => void): ChatRecord | null {
  const store = load();
  const record = store.chats[id];
  if (!record) return null;
  mutate(record);
  persist(store);
  return { ...record };
}

export interface TouchChatOptions {
  /** True on the end of a turn, so `turns` counts completed turns. */
  incrementTurns?: boolean;
}

/** Bumps `lastActiveAt` to now, and `turns` when a turn just finished. */
export function touchChat(id: string, options: TouchChatOptions = {}): ChatRecord | null {
  return update(id, (record) => {
    record.lastActiveAt = new Date().toISOString();
    if (options.incrementTurns) record.turns += 1;
  });
}

export function setTitle(id: string, title: string, source: 'fallback' | 'haiku'): ChatRecord | null {
  return update(id, (record) => {
    record.title = title;
    record.titleSource = source;
    // A successful title (fallback or haiku) is not a failed try; only
    // recordTitleTryFailure (below) advances titleTries.
  });
}

/** Records a failed Haiku title attempt, leaving the current (fallback)
 *  title in place. Not in T3's required export list, but T7's `queueTitle`
 *  needs somewhere to record `titleTries++` without this store growing a
 *  bespoke setter per ticket — see the ticket's forward-compat note. */
export function recordTitleTryFailure(id: string): ChatRecord | null {
  return update(id, (record) => {
    record.titleTries += 1;
  });
}

export function setRunningJob(id: string, jobId: string | null): ChatRecord | null {
  return update(id, (record) => {
    record.runningJobId = jobId;
  });
}

export function archiveChat(id: string): ChatRecord | null {
  return update(id, (record) => {
    record.archived = true;
  });
}

export function restoreChat(id: string): ChatRecord | null {
  return update(id, (record) => {
    record.archived = false;
  });
}

/** Sets `deleted: true` only. Never touches any transcript file — SAM can
 *  recover a chat by clearing the flag on disk by hand. */
export function deleteChat(id: string): ChatRecord | null {
  return update(id, (record) => {
    record.deleted = true;
  });
}

/** Links a completed handoff (T18): the old chat gains `handedOffTo`, the
 *  new one `handedOffFrom`. Both records must already exist. */
export function markHandedOff(oldId: string, newId: string): void {
  update(oldId, (record) => {
    record.handedOffTo = newId;
  });
  update(newId, (record) => {
    record.handedOffFrom = oldId;
  });
}

/** Records that a handoff's memo turn ran but produced no memo file (T18). */
export function setHandoffError(id: string, error: string): ChatRecord | null {
  return update(id, (record) => {
    record.handoffError = error;
  });
}
