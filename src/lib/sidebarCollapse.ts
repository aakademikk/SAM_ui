/**
 * SAM — remembers whether the desktop Sidebar is collapsed to an icon rail.
 *
 * Same shape as `chatListCollapse.ts` (own key — this is a separate, unrelated
 * collapse state, not to be merged with the chat list's). Takes a `Storage`
 * rather than touching `localStorage` itself — no React, no DOM — so it runs
 * under plain `node --test`. Anything but the exact stored flag reads as
 * expanded: a corrupt value must never hide the nav.
 */

export const SIDEBAR_COLLAPSE_KEY = 'sam-sidebar-collapsed';

export function readSidebarCollapsed(storage: Storage): boolean {
  return storage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
}

export function writeSidebarCollapsed(storage: Storage, collapsed: boolean): void {
  if (collapsed) storage.setItem(SIDEBAR_COLLAPSE_KEY, '1');
  else storage.removeItem(SIDEBAR_COLLAPSE_KEY);
}
