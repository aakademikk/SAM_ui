/**
 * SAM — the server's own record of every side message sent into a running
 * turn.
 *
 * Persisted to `~/.sam/samui-side-messages.json`, one list of records per
 * chat id. `sendSideMessage` (sideMessage.ts) appends a record the instant a
 * side message is actually delivered into a turn's stdin; T8's transcript
 * replay later matches each record against the transcript entry the CLI
 * wrote for it (by text), so a reload never mistakes a side message for a
 * second top-level turn.
 *
 * Persistence follows the same pattern as `chatStore.ts`: the path is
 * resolved from `os.homedir()` on every load (not cached at module load, so
 * a test that points `HOME` at a temp dir before importing reads and writes
 * the right file), the loaded value is cached on `globalThis` so every route
 * handler shares one copy across module reloads, and every write is atomic
 * (temp file, then `rename`).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SideMessageRecord {
  text: string;
  sentAt: string;
  /** Set by T8's `tagPending` once this record is matched to the transcript
   *  entry the CLI wrote for it. Absent until then. */
  taggedUuid?: string;
}

type SideMessageStore = Record<string, SideMessageRecord[]>;

function storeFile(): string {
  return path.join(os.homedir(), '.sam', 'samui-side-messages.json');
}

const globalForSam = globalThis as unknown as { __samuiSideMessageLog?: SideMessageStore };

function load(): SideMessageStore {
  const cached = globalForSam.__samuiSideMessageLog;
  if (cached) return cached;

  let store: SideMessageStore = {};
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      store = parsed as SideMessageStore;
    }
  } catch {
    // First run, or a corrupt/missing file — start empty, same as
    // chatStore.ts and samuiSessions.ts.
  }
  globalForSam.__samuiSideMessageLog = store;
  return store;
}

function persist(store: SideMessageStore): void {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic: temp file in the same directory, then rename — a write
  // interrupted mid-truncate must not leave a corrupt file that load()
  // silently treats as empty, which here would mean every side message ever
  // sent vanishing from the record.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

/** Test-only: drop the cached store so the next call re-reads from disk (or
 *  from a freshly pointed `HOME`). Mirrors the reset seam every other
 *  globalThis-cached store in this codebase needs for isolated tests. */
export function __resetSideMessageLogForTests(): void {
  delete globalForSam.__samuiSideMessageLog;
}

/** Records that a side message was delivered into a chat's running turn.
 *  Called only once `deliverSideMessage` itself reports success — a side
 *  message that failed to land is never recorded here. */
export function recordSideMessageSent(chatId: string, text: string): void {
  const store = load();
  // Same `__proto__`/`constructor` guard chatStore.ts uses: a chat id that
  // happens to resolve to Object.prototype's own members must never be
  // mistaken for an existing per-chat list.
  if (!Object.prototype.hasOwnProperty.call(store, chatId)) {
    store[chatId] = [];
  }
  store[chatId].push({ text, sentAt: new Date().toISOString() });
  persist(store);
}

function listFor(store: SideMessageStore, chatId: string): SideMessageRecord[] {
  return Object.prototype.hasOwnProperty.call(store, chatId) ? store[chatId] : [];
}

/** Every `taggedUuid` already assigned for this chat (T8) — either a late
 *  side message's matched user-prompt entry, or (to mark the record resolved
 *  without ever touching a user entry) a mid-turn side message's own
 *  queued_command attachment uuid. */
export function taggedUuids(chatId: string): Set<string> {
  const uuids = new Set<string>();
  for (const record of listFor(load(), chatId)) {
    if (record.taggedUuid) uuids.add(record.taggedUuid);
  }
  return uuids;
}

/** Records with no `taggedUuid` yet, oldest `sentAt` first — what T8's
 *  `tagSideMessages` still has to match against the transcript. */
export function unresolved(chatId: string): { text: string; sentAt: string }[] {
  return listFor(load(), chatId)
    .filter((record) => !record.taggedUuid)
    .map((record) => ({ text: record.text, sentAt: record.sentAt }))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

/** Sets `taggedUuid` on the first still-unresolved record matching each
 *  pair's text, in the order the pairs are given. A pair whose text matches
 *  no unresolved record (already tagged by an earlier call, or a stale
 *  input) is silently skipped rather than throwing. */
export function tagPending(chatId: string, pairs: { text: string; uuid: string }[]): void {
  if (pairs.length === 0) return;
  const store = load();
  const list = listFor(store, chatId);
  if (list.length === 0) return;
  for (const pair of pairs) {
    const record = list.find((r) => !r.taggedUuid && r.text === pair.text);
    if (record) record.taggedUuid = pair.uuid;
  }
  persist(store);
}
