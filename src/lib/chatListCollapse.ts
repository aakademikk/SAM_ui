/**
 * SAM — remembers whether the desktop chat sidebar is collapsed.
 *
 * `ChatList` reads this once on mount and writes it on every toggle, so a
 * reload comes back the way Colin left it. Takes a `Storage` rather than
 * touching `localStorage` itself — no React, no DOM — so it runs under plain
 * `node --test`. Anything but the exact stored flag reads as expanded: a
 * corrupt value must never hide the list.
 */

export const COLLAPSE_KEY = 'sam-chatlist-collapsed';

export function readListCollapsed(storage: Storage): boolean {
  return storage.getItem(COLLAPSE_KEY) === '1';
}

export function writeListCollapsed(storage: Storage, collapsed: boolean): void {
  if (collapsed) storage.setItem(COLLAPSE_KEY, '1');
  else storage.removeItem(COLLAPSE_KEY);
}
