/**
 * SAM — which chat each device has on screen (T10).
 *
 * The server cannot see screens; it can only be told. Each device that has
 * the chat page visible reports the chat it is showing (T17 wires the
 * client side); this module just remembers the latest report per device and
 * answers "is this chat on screen anywhere?" for `turnPing.ts`.
 *
 * Keyed by whatever string the route hands in — `device:tabId` since review
 * finding 9, so two tabs or windows on one device each get their own entry
 * instead of overwriting each other's; this module itself does not care what
 * shape the key is, only that each live reporter uses a distinct one.
 *
 * A device that closes the tab, backgrounds it, or loses connectivity stops
 * reporting — there is no explicit "goodbye" — so a report is only trusted
 * for a short TTL rather than forever. 45s comfortably covers the poll/ping
 * interval T17 uses while a page is visible, and is short enough that a
 * closed tab stops counting as "on screen" well before Colin would notice a
 * missing ping for real.
 *
 * In-memory only, cached on `globalThis` exactly like `sessionLock.ts`'s
 * lock map, so every route handler shares one copy across Next.js dev-mode
 * module reloads. A server restart simply forgets every device's focus,
 * which is safe: the next report re-establishes it, and until then every
 * chat reads as off-screen (the safer default — a missed ping is far less
 * annoying than a wrong "no ping" while Colin is actually looking at it).
 */

const FOCUS_TTL_MS = 45_000;

interface FocusEntry {
  chatId: string | null;
  at: number;
}

const globalForSam = globalThis as unknown as { __samChatFocus?: Map<string, FocusEntry> };
const focusByDevice =
  globalForSam.__samChatFocus ?? (globalForSam.__samChatFocus = new Map());

/** Record the chat `device` currently has on screen, or `null` when it has
 *  navigated away from every chat (e.g. to the chat list or another page). */
export function setFocus(device: string, chatId: string | null): void {
  focusByDevice.set(device, { chatId, at: Date.now() });
}

/**
 * True when some device reported `chatId` on screen within the last 45s.
 * Multiple devices can hold focus at once (phone and PC both open on the
 * same chat) — any live report is enough.
 */
export function isOnScreen(chatId: string, now: number = Date.now()): boolean {
  for (const entry of focusByDevice.values()) {
    if (entry.chatId === chatId && now - entry.at <= FOCUS_TTL_MS) return true;
  }
  return false;
}

/** Test-only: forget every device's focus. */
export function __resetFocusForTests(): void {
  focusByDevice.clear();
}
