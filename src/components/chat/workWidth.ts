/**
 * SAM — width maths for the desktop work panel's draggable divider.
 * Minimum 320px, maximum 70% of the viewport, persisted in localStorage.
 */
export const WORK_MIN_WIDTH = 320;
export const WORK_MAX_FRACTION = 0.7;
export const WORK_WIDTH_KEY = 'sam.workPanelWidth';

export function maxWorkWidth(viewport: number): number {
  return Math.max(WORK_MIN_WIDTH, Math.floor(viewport * WORK_MAX_FRACTION));
}

export function clampWorkWidth(width: number, viewport: number): number {
  if (!Number.isFinite(width)) return WORK_MIN_WIDTH;
  return Math.min(maxWorkWidth(viewport), Math.max(WORK_MIN_WIDTH, Math.round(width)));
}

/** The panel sits on the right, so its width is the distance from the pointer to the right edge. */
export function widthFromPointer(clientX: number, viewport: number): number {
  return clampWorkWidth(viewport - clientX, viewport);
}

/** The saved width clamped to this window, or null when nothing usable is saved. */
export function readStoredWidth(store: Pick<Storage, 'getItem'>, viewport: number): number | null {
  try {
    const raw = store.getItem(WORK_WIDTH_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampWorkWidth(n, viewport) : null;
  } catch {
    return null;
  }
}
