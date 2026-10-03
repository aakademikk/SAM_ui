/**
 * SAM — the Dashboard chat widget's pure logic (visual upgrade T14, Must 3e).
 *
 * No React, no DOM, no fetch: a plain list in, a plain answer out, so
 * `node --test` can run it (`DashboardChatWidget.test.ts`).
 */

import { filterChatTitles } from '@/lib/chatListFilter';
import type { ChatBlock, ChatMessage, ChatSummary, ChatTier, TierId } from '@/types/chat';

/**
 * The chat the widget opens on: the most recently active one, in the same
 * order the server's list uses (`chatStore.listChats`: `lastActiveAt`,
 * newest first). Sorted here too rather than trusting the response order,
 * so the pick never depends on how the list arrived. Ties keep the list's
 * own order. `null` for an empty list.
 */
export function pickMostRecentChat(chats: readonly ChatSummary[]): string | null {
  let best: ChatSummary | null = null;
  for (const chat of chats) {
    if (!best || chat.lastActiveAt.localeCompare(best.lastActiveAt) > 0) best = chat;
  }
  return best ? best.id : null;
}

/**
 * The picker's rows: the main list, filtered by title with the Chat page's
 * own rule (`filterChatTitles`, multi-chat T16), unfiltered when the box is
 * empty or only spaces.
 */
export function pickerChats<T extends { title: string }>(chats: T[], query: string): T[] {
  const q = query.trim();
  return q ? filterChatTitles(chats, q) : chats;
}

/**
 * The tier a send to an existing chat uses: the chat's own (its tier is fixed
 * by its first message, multi-chat Must 9). An imported chat with no single
 * tier runs on `max`, the same fallback the Chat page and `startTurn` apply.
 */
export function sendTierFor(tier: ChatTier | null | undefined): TierId {
  return tier && tier !== 'unknown' ? tier : 'max';
}

/** What the compact list shows for one message: the user's words, or SAM's answer (its last text block), or its error. */
export function messageLine(message: ChatMessage): string {
  const texts = message.blocks.filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text');
  if (message.role === 'user') return texts.map((b) => b.text).join('\n').trim();
  const answer = texts[texts.length - 1]?.text.trim();
  if (answer) return answer;
  const error = message.blocks.find((b): b is Extract<ChatBlock, { kind: 'error' }> => b.kind === 'error');
  return error ? error.text : '';
}
