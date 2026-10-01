/**
 * SAM — holding and recovering a message that failed on biometric unlock,
 * lifted out of page.tsx so the per-chat targeting is testable without a
 * browser (review finding 4, 2026-10-01).
 *
 * A message typed into chat A that fails on step-up must go back to chat A
 * on unlock — never to whichever chat happens to be on screen by then.
 * Built on chatLocal.ts's existing per-chat pending-message slots
 * (`savePendingMessage` / `loadPendingMessage` / `clearPendingMessage`),
 * which nothing called before this.
 */

import { clearPendingMessage, loadPendingMessage, savePendingMessage } from '@/lib/chatLocal';

/** Hold a message that needs step-up, against the chat it was written in. */
export function holdPendingMessage(storage: Storage, chatId: string, message: string): void {
  savePendingMessage(storage, chatId, message);
}

/**
 * The message to resend now, if any — only ever the one held for the chat
 * that is on screen right now. A message held for a different chat is left
 * exactly where it is, to be recovered when that chat is reopened.
 */
export function recoverPendingMessage(storage: Storage, currentId: string): string | null {
  const message = loadPendingMessage(storage, currentId);
  if (message) clearPendingMessage(storage, currentId);
  return message;
}

/** A fresh send to `chatId` supersedes any message this chat was still
 *  holding from an earlier failed send — chats other than `chatId` are
 *  untouched. */
export function supersedePendingMessage(storage: Storage, chatId: string): void {
  clearPendingMessage(storage, chatId);
}
