/**
 * SAM — tileLayout: pure order / size / hidden logic for the fleet
 * dashboard's tiles (System Health, Daily Tasks, Money In, Usage limits).
 *
 * No DOM and no store: `tileLayoutStore` wraps these functions and keeps the
 * result on this device only.
 */

export type TileId = 'system-health' | 'daily-tasks' | 'money-in' | 'usage-limits';
export type TileSize = 'sm' | 'tall';

export interface TileItem {
  id: TileId;
  size: TileSize;
  hidden: boolean;
}

/** localStorage key for the per-device tile layout (never `sam.preferences.v1`). */
export const TILE_LAYOUT_STORAGE_KEY = 'sam.fleet-tiles.v1';

export const DEFAULT_TILES: TileItem[] = [
  { id: 'system-health', size: 'sm', hidden: false },
  { id: 'daily-tasks', size: 'sm', hidden: false },
  { id: 'money-in', size: 'sm', hidden: false },
  // Tall by default: the compact (sm) profile shows only a seat's higher percent,
  // and the tile must show both windows and both reset times (spec U1).
  { id: 'usage-limits', size: 'tall', hidden: false },
];

const KNOWN_TILES = new Set<TileId>(DEFAULT_TILES.map((t) => t.id));

export const TILE_HEIGHT_SM = 176;

/** Pixel height of a tile: one row for `sm`, two rows plus the gap for `tall`. */
export function tileHeight(size: TileSize, gap = 12): number {
  return size === 'tall' ? 2 * TILE_HEIGHT_SM + gap : TILE_HEIGHT_SM;
}

/** Persisted tiles outlive deploys: drop unknowns and duplicates, repair, append missing. */
export function reconcileTiles(persisted: unknown): TileItem[] {
  if (!Array.isArray(persisted)) return DEFAULT_TILES.map((t) => ({ ...t }));

  const seen = new Set<TileId>();
  const result: TileItem[] = [];

  for (const raw of persisted) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Partial<Record<keyof TileItem, unknown>>;
    const id = item.id as TileId;
    if (typeof id !== 'string' || !KNOWN_TILES.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      size: item.size === 'tall' ? 'tall' : 'sm',
      hidden: item.hidden === true,
    });
  }

  for (const fallback of DEFAULT_TILES) {
    if (!seen.has(fallback.id)) result.push({ ...fallback });
  }

  return result;
}

/** arrayMove semantics; ids not in the list (or the same id) are a no-op. */
export function reorderTiles(items: TileItem[], activeId: TileId, overId: TileId): TileItem[] {
  if (activeId === overId) return items;
  const from = items.findIndex((t) => t.id === activeId);
  const to = items.findIndex((t) => t.id === overId);
  if (from === -1 || to === -1) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Index in `items` of the visible neighbour in `dir`, or -1 when there is none. */
function visibleNeighbour(items: TileItem[], id: TileId, dir: -1 | 1): number {
  const index = items.findIndex((t) => t.id === id);
  if (index === -1 || items[index].hidden) return -1;
  for (let i = index + dir; i >= 0 && i < items.length; i += dir) {
    if (!items[i].hidden) return i;
  }
  return -1;
}

export function canMove(items: TileItem[], id: TileId, dir: -1 | 1): boolean {
  return visibleNeighbour(items, id, dir) !== -1;
}

/**
 * Move a tile one VISIBLE place. Hidden tiles keep their slot. Returns the
 * same array when the tile is already at that end.
 */
export function moveTile(items: TileItem[], id: TileId, dir: -1 | 1): TileItem[] {
  const index = items.findIndex((t) => t.id === id);
  const target = visibleNeighbour(items, id, dir);
  if (index === -1 || target === -1) return items;
  const next = items.slice();
  next[index] = items[target];
  next[target] = items[index];
  return next;
}

function patchTile(items: TileItem[], id: TileId, patch: Partial<TileItem>): TileItem[] {
  return items.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

export function setTileSize(items: TileItem[], id: TileId, size: TileSize): TileItem[] {
  return patchTile(items, id, { size });
}

export function hideTile(items: TileItem[], id: TileId): TileItem[] {
  return patchTile(items, id, { hidden: true });
}

/** Hidden flag only: the tile keeps its slot and size while hidden. */
export function restoreTile(items: TileItem[], id: TileId): TileItem[] {
  return patchTile(items, id, { hidden: false });
}

export function visibleTiles(items: TileItem[]): TileItem[] {
  return items.filter((t) => !t.hidden);
}

/**
 * Where keyboard focus goes when `id` is hidden: the next visible tile, else
 * the previous one, else null (the "Hidden tiles (n)" button takes it).
 */
export function focusAfterHide(items: TileItem[], id: TileId): TileId | null {
  const visible = visibleTiles(items);
  const at = visible.findIndex((t) => t.id === id);
  if (at === -1) return visible[0]?.id ?? null;
  return visible[at + 1]?.id ?? visible[at - 1]?.id ?? null;
}

export function hiddenTiles(items: TileItem[]): TileItem[] {
  return items.filter((t) => t.hidden);
}
