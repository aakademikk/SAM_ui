/**
 * SAM — client-side title search for the chat list (spec must-do 9a).
 *
 * `ChatList` runs this against whatever list it already has (the main list's
 * `chats` prop, or the Archived fetch) rather than round-tripping every
 * keystroke to the server. It is the exact rule `filterByTitle` in
 * `src/lib/server/chat/chatStore.ts` enforces server-side — case-insensitive
 * substring on `title` only, never `firstMessage` or any other field — kept
 * here as a separate, dependency-free copy (no React, no DOM) so it is
 * importable under plain `node --test` and testable without a browser.
 */

export function filterChatTitles<T extends { title: string }>(chats: T[], q: string): T[] {
  const needle = q.toLowerCase();
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle));
}
