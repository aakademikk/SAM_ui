/**
 * SAM — side-message routing rules for the chat page (spec must-do 1, 2, 6,
 * 13; T6).
 *
 * Pure and dependency-free (type-only import, erased at compile time) so it
 * is importable under plain `node --test` — no React, no DOM.
 */

import type { ChatTier } from '@/types/chat';

/** Claude tiers only (spec constraints, Colin grill 2026-10-03) — the only
 *  tiers whose running turn can take a side message. */
export function canTakeSideMessages(tier: ChatTier): boolean {
  return tier === 'max' || tier === 'max2';
}

export type SendRoute = 'start' | 'side' | 'blocked';

/** Where a send() call should go: a fresh turn when nothing is running; into
 *  the running turn's side channel on Max/Max 2; otherwise blocked, exactly
 *  as today (Fast, Pro, Gemini, and an unknown-tier chat). */
export function decideSendRoute(input: { running: boolean; tier: ChatTier }): SendRoute {
  if (!input.running) return 'start';
  return canTakeSideMessages(input.tier) ? 'side' : 'blocked';
}

/** The "kept on screen" rule for a failed side message (spec must-do 6): a
 *  delivered message clears the composer; a failed one leaves its text so
 *  it isn't lost. */
export function nextComposerText(delivered: boolean, sentText: string): string {
  return delivered ? '' : sentText;
}

/** Whether hands-free should keep listening for a transcript: always when no
 *  turn is running, and during a running turn only on a chat that can take a
 *  side message (spec must-do 13). HandsFreeMic's own `working` prop means
 *  "do not listen", so a caller passes `!handsFreeListens(...)` as `working`. */
export function handsFreeListens(input: { running: boolean; tier: ChatTier }): boolean {
  return !input.running || canTakeSideMessages(input.tier);
}
