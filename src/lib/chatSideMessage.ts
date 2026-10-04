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

/** The one tier every side-message decision on the chat page reads (the send
 *  box, hands-free and `send()` all call this, so they cannot disagree). A
 *  draft has no chat id yet — while its first turn is starting there is
 *  nowhere to send a side message — so it routes as 'unknown' (blocked); the
 *  page records the started turn's tier on the chat info the moment the id
 *  arrives, and from then on the chat's own tier decides. */
export function sideRouteTier(input: { chatId: string; chatInfoTier: ChatTier | undefined }): ChatTier {
  if (input.chatId === 'draft') return 'unknown';
  return input.chatInfoTier ?? 'unknown';
}

/** Where a send() call should go: a fresh turn when nothing is running; into
 *  the running turn's side channel on Max/Max 2; otherwise blocked, exactly
 *  as today (Fast, Pro, Gemini, and an unknown-tier chat). `handoffWaiting`
 *  is true while this chat's handoff is in progress: its running turn is the
 *  handoff's memo turn, which takes no side messages. */
export function decideSendRoute(input: {
  running: boolean;
  tier: ChatTier;
  handoffWaiting?: boolean;
}): SendRoute {
  if (!input.running) return 'start';
  if (input.handoffWaiting) return 'blocked';
  return canTakeSideMessages(input.tier) ? 'side' : 'blocked';
}

/** What to tell Colin when a send was refused because the route is blocked. */
export function blockedSendError(input: { handoffWaiting?: boolean }): string {
  return input.handoffWaiting
    ? 'A handoff is in progress. Wait for the new chat, then send.'
    : 'SAM is still working on this. Wait for the answer, then send again.';
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
export function handsFreeListens(input: {
  running: boolean;
  tier: ChatTier;
  handoffWaiting?: boolean;
}): boolean {
  return !input.running || decideSendRoute(input) === 'side';
}
