'use client';

/**
 * SAM — Fleet tile layout store.
 *
 * Order, sizes and hidden state of the dashboard's three tiles, kept on this
 * device only (localStorage, its own key). Deliberately no server sync.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import {
  DEFAULT_TILES,
  TILE_LAYOUT_STORAGE_KEY,
  hideTile,
  moveTile,
  reconcileTiles,
  reorderTiles,
  restoreTile,
  setTileSize,
  type TileId,
  type TileItem,
  type TileSize,
} from '@/components/dashboard/fleet/tileLayout';

export { TILE_LAYOUT_STORAGE_KEY };

export interface TileLayoutState {
  tiles: TileItem[];
  /** Transient (not persisted): the tile currently shown fullscreen. */
  fullscreen: TileId | null;

  reorder: (activeId: TileId, overId: TileId) => void;
  move: (id: TileId, dir: -1 | 1) => void;
  setSize: (id: TileId, size: TileSize) => void;
  hide: (id: TileId) => void;
  restore: (id: TileId) => void;
  reset: () => void;

  openFullscreen: (id: TileId) => void;
  closeFullscreen: () => void;
}

export const useTileLayoutStore = create<TileLayoutState>()(
  persist(
    (set) => ({
      tiles: DEFAULT_TILES.map((t) => ({ ...t })),
      fullscreen: null,

      reorder: (activeId, overId) =>
        set((s) => ({ tiles: reorderTiles(s.tiles, activeId, overId) })),
      move: (id, dir) => set((s) => ({ tiles: moveTile(s.tiles, id, dir) })),
      setSize: (id, size) => set((s) => ({ tiles: setTileSize(s.tiles, id, size) })),
      hide: (id) => set((s) => ({ tiles: hideTile(s.tiles, id) })),
      restore: (id) => set((s) => ({ tiles: restoreTile(s.tiles, id) })),
      reset: () => set({ tiles: DEFAULT_TILES.map((t) => ({ ...t })) }),

      openFullscreen: (fullscreen) => set({ fullscreen }),
      closeFullscreen: () => set({ fullscreen: null }),
    }),
    {
      name: TILE_LAYOUT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tiles: state.tiles }),
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<TileLayoutState>;
        return { ...current, tiles: reconcileTiles(incoming.tiles) };
      },
    },
  ),
);
