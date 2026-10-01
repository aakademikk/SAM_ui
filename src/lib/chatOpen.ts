/**
 * SAM — deciding what the chat page's `/chat?c=` deep link and its mount
 * restore should do, lifted out of page.tsx so the decisions are testable
 * without a browser (review findings 1 and 5, 2026-10-01).
 */

import { getCurrentChatId } from '@/lib/chatLocal';

/* ── `/chat?c=<id>` ─────────────────────────────────────────────────────── */

export interface ChatLinkDeps {
  /** The session-only GET /api/chats/[id], wired to the page's
   *  openChatById. Never rejects — resolves false on any failure (not
   *  found, step-up required, or otherwise), the same boolean contract
   *  openChatById itself uses. */
  open: (id: string) => Promise<boolean>;
  /** Legacy inputs, kept only so the regression tests below can prove the
   *  fixed policy never uses them. */
  isCached?: (id: string) => boolean;
  adopt?: (id: string) => Promise<unknown>;
}

/**
 * `/chat?c=<id>` opens a chat through the session-only GET alone — never the
 * step-up-gated adopt call, which a phone's 10-minute window has usually
 * lost by the time a ping is tapped, and which un-archives the chat as a
 * side effect that a deep-link open must never cause (review finding 1,
 * 2026-10-01: before this, an id not yet cached on the device went through
 * adopt, and the `c` param was stripped from the URL even when that failed,
 * so a lapsed step-up silently ate the link). Returns whether the link has
 * done its job and `c` can be dropped from the URL — false on any failure,
 * so a reload or a second tap retries it rather than the link being
 * silently consumed.
 */
export async function handleChatLink(id: string, deps: ChatLinkDeps): Promise<boolean> {
  return deps.open(id);
}

/* ── Mount ──────────────────────────────────────────────────────────────── */

/**
 * The chat to force-load fresh from the server on mount, so `chatInfo`
 * (tier, turns, handoff fields) is populated before the first send rather
 * than staying null until the 5s list poll happens to find this id — which
 * it never does for an archived chat, or one not yet in the list (review
 * finding 5, 2026-10-01: with `chatInfo` null, a send fell back to tier
 * `max` and any non-Max chat got a 409). `null` for a draft, or before any
 * chat id is known. Call after `migrateLegacy`, so a pre-upgrade device's
 * freshly migrated id is included.
 */
export function mountOpenTarget(storage: Storage): string | null {
  const id = getCurrentChatId(storage);
  return id && id !== 'draft' ? id : null;
}
