/**
 * SAM — title search for the chat list, client and server alike (spec
 * must-do 9a; review finding 14).
 *
 * Case-insensitive substring on `title` only, never `firstMessage` or any
 * other field. `ChatList` runs this against whatever list it already has
 * (the main list's `chats` prop, or the Archived fetch) rather than
 * round-tripping every keystroke to the server; `chatStore.ts`'s `listChats`
 * imports this same function (as `filterByTitle`) for the server-side `?q=`
 * filter, rather than keeping its own copy. Dependency-free (no React, no
 * DOM, no node builtins) so both sides — and `node --test` — can import it
 * with no bundling concerns.
 */

export function filterChatTitles<T extends { title: string }>(chats: T[], q: string): T[] {
  const needle = q.toLowerCase();
  return chats.filter((chat) => chat.title.toLowerCase().includes(needle));
}
