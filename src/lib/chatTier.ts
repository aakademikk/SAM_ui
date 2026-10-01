/**
 * SAM — tier-lock and tier-display rules for the chat page (spec must-do 9,
 * 9b; T19).
 *
 * A chat's tier is fixed by its first message; after that only a handoff
 * (T18, a new chat) can change it. A chat's id IS the Claude CLI session id
 * handed back by its first send (T14), so any id that isn't the `'draft'`
 * placeholder has, by construction, already had its first message — the
 * `turns` check below only matters for a server record reporting turns
 * before a caller has updated its own notion of the id.
 *
 * Pure and dependency-free (type-only import, erased at compile time) so it
 * is importable under plain `node --test` — no React, no DOM.
 */

import type { ChatTier, TierId } from '@/types/chat';

/** The minimal shape `tierLocked` needs — not the full ChatRecord or
 *  ChatSummary, so a caller doesn't have to build one just to check a lock. */
export interface TierLockChat {
  id: string;
  turns?: number;
}

/** True once the tier button must no longer change this chat's tier. */
export function tierLocked(chat: TierLockChat | null): boolean {
  if (!chat) return false;
  return chat.id !== 'draft' || (chat.turns ?? 0) > 0;
}

/** The minimal shape `displayTier` needs. */
export interface TierDisplayChat {
  id: string;
  tier: ChatTier;
}

/**
 * The tier to show on the button: the chat's own tier once it has one, or
 * the freely-chosen draft tier before that. An imported chat whose
 * transcript mixed models (`ChatTier` `'unknown'`) shows as `'Unknown'`
 * rather than a tier id — there is no single tier to run it on until a
 * handoff gives it one.
 */
export function displayTier(chat: TierDisplayChat | null, draftTier: TierId): TierId | 'Unknown' {
  if (!chat || chat.id === 'draft') return draftTier;
  return chat.tier === 'unknown' ? 'Unknown' : chat.tier;
}
