/**
 * SAM — per-chat local storage.
 *
 * Before T14, a device held exactly one conversation under four flat keys
 * (`sam-agent-session`, `sam-agent-messages`, `sam-agent-active`,
 * `sam-agent-pending`), and New worked by deleting them — which threw away
 * whatever chat was on screen along with it. Spec must-do 3 and 14 say New
 * must never wipe, delete or overwrite any other chat, and a pre-upgrade
 * device's chat must keep its history. This module gives every chat its own
 * slice of storage instead, keyed by id, so starting a fresh chat only ever
 * points `sam-chat-current` at a new id — every other chat's keys are
 * untouched.
 *
 * `resetConversation` is the module's public New function: it points the
 * screen at a fresh draft and touches nothing else, so no chat is ever
 * wiped, deleted or overwritten (spec must-do 3, 14; check 2).
 */

import type { ChatMessage } from '@/types/chat';

/** Legacy flat keys a pre-upgrade device still has its one chat under. */
export const SESSION_KEY = 'sam-agent-session';
export const MESSAGES_KEY = 'sam-agent-messages';
export const ACTIVE_KEY = 'sam-agent-active';
export const PENDING_KEY = 'sam-agent-pending';

/** Per-chat message history is capped the same as the old global list was. */
export const MAX_STORED = 40;

/** Id of the chat on screen, or the literal `'draft'` for one not yet started. */
const CURRENT_KEY = 'sam-chat-current';
const DRAFT = 'draft';

const messagesKey = (id: string) => `sam-chat-messages:${id}`;
/** Chat ids in the order their caches were last saved, oldest first (what a full device evicts first). */
const LRU_KEY = 'sam-chat-lru';
const activeKey = (id: string) => `sam-chat-active:${id}`;
const pendingKey = (id: string) => `sam-chat-pending:${id}`;

/**
 * New. Points the screen at a fresh, unsaved chat — the previous chat's
 * history, active run and pending message all stay exactly where they are,
 * so New never wipes, deletes or overwrites anything (spec must-do 3, 14).
 */
export function resetConversation(storage: Storage): void {
  startDraft(storage);
}

/** Every chat id this device holds local history for. */
export function localChatIds(storage: Storage): string[] {
  const prefix = 'sam-chat-messages:';
  const ids: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) ids.push(key.slice(prefix.length));
  }
  return ids;
}

export function loadChatMessages(storage: Storage, id: string): ChatMessage[] {
  try {
    const raw = storage.getItem(messagesKey(id));
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch { /* corrupted */ }
  return [];
}

/*
 * A full device (Colin's laptop, 2026-10-03): every chat ever opened kept up to
 * 40 messages here with nothing ever evicted, until one tool-heavy chat took the
 * origin past the browser's ~5 MB and `setItem` threw QuotaExceededError on
 * opening it. This cache is disposable: the server holds every chat's full
 * history and `openChat` repaints it. So a save never throws. When the device
 * is full it drops other chats' caches, least recently saved first, then keeps
 * fewer of this chat's messages (newest kept), and at worst caches nothing.
 */
function tryWrite(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readLru(storage: Storage): string[] {
  try {
    const v = JSON.parse(storage.getItem(LRU_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function touchLru(storage: Storage, id: string): void {
  tryWrite(storage, LRU_KEY, JSON.stringify([...readLru(storage).filter((x) => x !== id), id].slice(-200)));
}

/** Other chats' caches in eviction order: ones the LRU never saw (oldest, pre-LRU) first, then least recent. */
function evictionOrder(storage: Storage, keep: string): string[] {
  const held = localChatIds(storage).filter((x) => x !== keep);
  const lru = readLru(storage);
  return [...held.filter((x) => !lru.includes(x)), ...lru.filter((x) => held.includes(x))];
}

/** Writes `key`, clearing other chats' message caches (oldest first) to make room. False if it still won't fit. */
function writeWithRoom(storage: Storage, key: string, value: string, keep: string): boolean {
  if (tryWrite(storage, key, value)) return true;
  for (const other of evictionOrder(storage, keep)) {
    storage.removeItem(messagesKey(other));
    if (tryWrite(storage, key, value)) return true;
  }
  return false;
}

/** Caps at MAX_STORED, same as the old global list did. Never throws (see above). */
export function saveChatMessages(storage: Storage, id: string, messages: ChatMessage[]): void {
  let keep = messages.slice(-MAX_STORED);
  let ok = writeWithRoom(storage, messagesKey(id), JSON.stringify(keep), id);
  while (!ok && keep.length > 1) {
    keep = keep.slice(Math.ceil(keep.length / 2)); // the newest half
    ok = tryWrite(storage, messagesKey(id), JSON.stringify(keep));
  }
  if (!ok) {
    storage.removeItem(messagesKey(id)); // a stale copy would repaint wrong history
    return;
  }
  touchLru(storage, id);
}

/** The chat on screen: an id, `'draft'`, or null when never set (e.g. a
 *  brand-new device, before migration has run). */
export function getCurrentChatId(storage: Storage): string | null {
  return storage.getItem(CURRENT_KEY);
}

export function setCurrentChatId(storage: Storage, id: string): void {
  writeWithRoom(storage, CURRENT_KEY, id, id);
}

/**
 * Switches the screen to a fresh, unsaved chat. Touches no other key — the
 * previous chat's history, active run and pending message all stay exactly
 * where they are, so New never wipes, deletes or overwrites anything.
 */
export function startDraft(storage: Storage): void {
  writeWithRoom(storage, CURRENT_KEY, DRAFT, DRAFT);
}

/** A turn in flight for one chat. Generic because the shape (`ActiveRun`) is
 *  the page's concern, not this module's. */
export function loadActiveRun<T>(storage: Storage, id: string): T | null {
  try {
    const raw = storage.getItem(activeKey(id));
    if (raw) return JSON.parse(raw) as T;
  } catch { /* corrupted */ }
  return null;
}

/** Never throws: a full device clears other chats' message caches to make room for this small record. */
export function saveActiveRun<T>(storage: Storage, id: string, run: T): void {
  writeWithRoom(storage, activeKey(id), JSON.stringify(run), id);
}

export function clearActiveRun(storage: Storage, id: string): void {
  storage.removeItem(activeKey(id));
}

export function loadPendingMessage(storage: Storage, id: string): string | null {
  return storage.getItem(pendingKey(id));
}

export function savePendingMessage(storage: Storage, id: string, message: string): void {
  writeWithRoom(storage, pendingKey(id), message, id);
}

export function clearPendingMessage(storage: Storage, id: string): void {
  storage.removeItem(pendingKey(id));
}

/**
 * A pre-upgrade device has its one chat under the legacy flat keys. Copy its
 * history into the per-chat format, point `current` at it, and remove the
 * legacy keys, since once copied they are read from nowhere else. Returns the
 * migrated id so the page can also tell the server about it
 * (`chatsService.adopt`, T6); null when there was nothing to migrate.
 */
export function migrateLegacy(storage: Storage): string | null {
  const id = storage.getItem(SESSION_KEY);
  if (!id) return null;

  const raw = storage.getItem(MESSAGES_KEY);
  if (raw) storage.setItem(messagesKey(id), raw);
  storage.setItem(CURRENT_KEY, id);
  storage.removeItem(SESSION_KEY);
  storage.removeItem(MESSAGES_KEY);
  storage.removeItem(ACTIVE_KEY);
  storage.removeItem(PENDING_KEY);
  return id;
}
