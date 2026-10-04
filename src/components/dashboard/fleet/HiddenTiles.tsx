'use client';

/**
 * SAM — "Hidden tiles (n)" restore control (floor-fixes T5, Must 4, 22).
 *
 * Sits at the end of the tile group while at least one tile is hidden: a full
 * width disclosure button that lists the hidden tiles by title, each with a
 * Restore button. Restore only clears the store's `hidden` flag, so the tile
 * comes back in its old place and size.
 */

import { useId, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { TileId } from './tileLayout';

export interface HiddenTilesProps {
  tiles: { id: TileId; title: string }[];
  onRestore: (id: TileId) => void;
}

export function HiddenTiles({ tiles, onRestore }: HiddenTilesProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (tiles.length === 0) return null;

  return (
    <div
      data-hidden-tiles=""
      className="overflow-hidden rounded-[5px] border border-[#3dff5a]/20 bg-black/20"
    >
      <button
        type="button"
        data-hidden-tiles-toggle=""
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-[12px] text-[#98b6a6] transition-colors hover:bg-white/6 hover:text-[#9dff70]"
      >
        <span>Hidden tiles ({tiles.length})</span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul id={listId} className="border-t border-[#3dff5a]/20">
          {tiles.map(({ id, title }) => (
            <li key={id} className="flex min-h-11 items-center justify-between gap-2 pl-3 text-[12px] text-[#98b6a6]">
              <span className="min-w-0 flex-1 truncate">{title}</span>
              <button
                type="button"
                data-restore-tile={id}
                aria-label={`Restore ${title}`}
                onClick={() => onRestore(id)}
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-3 text-[12px] text-[#9dff70] transition-colors hover:bg-white/6"
              >
                <RotateCcw size={12} />
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
