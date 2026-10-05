'use client';

/**
 * SAM — carried-over Dashboard widgets (T15, Must 3b; check 22).
 *
 * System Health, Daily Tasks and Money In from today's Dashboard
 * (`src/components/dashboard/widgets/`), the same components `/classic`
 * mounts, outside `StatCardGrid`'s `dnd-kit` machinery and its layout (see
 * Layout below). `ActiveProjectsWidget` is dropped
 * (Won't-do) and is not imported. `WIDGET_REGISTRY`/`StatCardGrid` are not
 * touched, so `/classic` keeps them exactly as they are today (T22).
 *
 * Data: each widget reads its own slice off `useDashboardStore` (`system`,
 * `tasks`, `money`) the same way it does on `/classic` — no fetch of its
 * own. Both fleet shells already `bootstrap()`/`startPolling()` that store
 * for the top bar's health chip, so by the time this mounts the same data
 * the old Dashboard shows is already arriving; these widgets show the same
 * values their APIs return (check 22) with nothing extra wired up here.
 *
 * Layout (floor-fixes T3, Must 2, 5, 28): these are "tiles" with their own
 * order, sizes and hidden state, kept on this device only in
 * `useTileLayoutStore` (`sam.fleet-tiles.v1`), never in `/classic`'s
 * `dashboardLayout` and never synced to `/api/dashboard/layout`. Each
 * visible tile renders in stored order, in a wrapper exactly
 * `tileHeight(size)` tall: Small is the `sm` footprint (176px) and Tall the
 * widget's `md-tall` content at twice that plus the gap, same width (the
 * column is one wide, so no Wide or Large). The `tile` prop puts
 * `WidgetFrame` in tile mode: its menu offers only Small / Tall / Move up /
 * Move down / Full screen / Hide / Refresh now and writes here, and it drops framer
 * `layoutId`/`layout` (two live instances sharing a `layoutId` fight, see
 * `FleetDashboardShell`). Hidden tiles are not rendered; the
 * "Hidden tiles (n)" control (`HiddenTiles`, floor-fixes T5, Must 4, 22) at
 * the end of the group lists them with a Restore button each. The group
 * scrolls inside itself (floor-fixes T7, Must 6); each placement's shell CSS
 * bounds its height, so Tall tiles never push Active jobs, Chat or the Ask
 * SAM bar off screen.
 *
 * Reorder (floor-fixes T4, Must 1, 27): the group is its own `DndContext`,
 * so nothing else on the dashboard is a drop target, and the dragged tile is
 * held to the group's box (vertical axis, parent element); a drop with the
 * pointer outside the group is refused (no `over`, the tile goes back). The
 * grip alone carries the sensors' listeners, so a finger anywhere else still
 * scrolls the page. Mouse: drag past 6px. Touch: hold ~120ms then drag.
 * Keyboard: Space on the grip lifts, arrows move, Space drops. No
 * `DragOverlay`: the tile itself moves (exactly one instance of each tile is
 * ever mounted). The menu's Move up / Move down do the same one step at a
 * time and put focus back on that tile's options button.
 *
 * Full screen (floor-fixes T6, Must 3, 8): the store's transient
 * `fullscreen` id, so it survives the group changing placement. The tile
 * renders into a host element that moves from its wrapper into <body> and
 * covers the viewport above the top bar, tab bar and Ask SAM bar (see
 * `SortableTile`); the wrapper keeps its height. Esc or Exit full screen
 * returns focus to the tile's options button. Demo on closes it.
 *
 * Demo mode (Must 19): renders nothing. The simplest way to guarantee no
 * live task, amount or health detail ever reaches the screen in demo mode;
 * T20 wires the `demo` switch into the view, T21 scans it.
 */

import {
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { WIDGET_REGISTRY, type WidgetProps } from '@/components/dashboard/widgetRegistry';
import { DailyTasksWidget } from '@/components/dashboard/widgets/DailyTasksWidget';
import { MoneyInWidget } from '@/components/dashboard/widgets/MoneyInWidget';
import { SystemHealthWidget } from '@/components/dashboard/widgets/SystemHealthWidget';
import { UsageLimitsWidget } from '@/components/dashboard/widgets/UsageLimitsWidget';
import { cn } from '@/lib/utils';
import { useTileLayoutStore } from '@/store/tileLayoutStore';

import { HiddenTiles } from './HiddenTiles';
import { canMove, focusAfterHide, hiddenTiles, tileHeight, visibleTiles, type TileId, type TileItem } from './tileLayout';

export interface SidebarWidgetsProps {
  /** Demo mode (T20): hides these widgets rather than showing live figures (Must 19). */
  demo?: boolean;
}

const TILE_WIDGETS: Record<TileId, ComponentType<WidgetProps>> = {
  'system-health': SystemHealthWidget,
  'daily-tasks': DailyTasksWidget,
  'money-in': MoneyInWidget,
  'usage-limits': UsageLimitsWidget,
};

const titleOf = (id: unknown) => WIDGET_REGISTRY[id as TileId]?.title ?? 'Tile';

/** Tile groups currently mounted (one at a time, two for a moment while it changes placement). */
let mountedGroups = 0;

/**
 * Mouse and pen only: touch goes to `TouchSensor` and its hold delay. Both
 * would otherwise see a touch (pointerdown fires first) and `PointerSensor`
 * would win, dropping the delay.
 */
class FinePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent, options: Parameters<(typeof PointerSensor.activators)[0]['handler']>[1]) =>
        event.nativeEvent.pointerType !== 'touch' && PointerSensor.activators[0].handler(event, options),
    },
  ];
}

/**
 * `closestCenter`, except a pointer (mouse or touch) outside the group's box
 * collides with nothing, so dropping a tile on Active jobs or Chat is refused.
 * The keyboard sensor has no pointer coordinates and always lands on a tile.
 */
const tileCollision: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  const rects = [...args.droppableRects.values()];
  if (p && rects.length > 0) {
    const inside =
      p.x >= Math.min(...rects.map((r) => r.left)) &&
      p.x <= Math.max(...rects.map((r) => r.right)) &&
      p.y >= Math.min(...rects.map((r) => r.top)) &&
      p.y <= Math.max(...rects.map((r) => r.bottom));
    if (!inside) return [];
  }
  return closestCenter(args);
};

/** Inline: the host fills the tile's wrapper. Full screen: it covers the viewport, above the tab bar (z-50). */
const HOST_INLINE = 'height:100%';
const HOST_FULLSCREEN =
  'position:fixed;inset:0;z-index:60;background:#030a07;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/**
 * Full screen while open: the page behind is pinned (no wheel, touch or
 * `scrollTo` moves it), Esc exits full screen ONLY (the capture-phase
 * listener stops it before the shells' own Esc handlers, which also skip a
 * `defaultPrevented` key), Tab stays inside the tile, and focus goes to the
 * Exit button. Undone on exit and on unmount (demo on, a route change),
 * which also restores the scroll position.
 */
function useFullscreenTile(host: HTMLElement | null, open: boolean, onExit: () => void) {
  const exitRef = useRef(onExit);
  useEffect(() => {
    exitRef.current = onExit;
  });

  useEffect(() => {
    if (!open || !host) return;
    const html = document.documentElement;
    const body = document.body;
    const y = window.scrollY;
    const prev = {
      html: html.style.overflow,
      body: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitRef.current();
      } else if (e.key === 'Tab') {
        const els = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        const at = document.activeElement;
        if (!host.contains(at) || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const frame = requestAnimationFrame(() => host.querySelector<HTMLElement>('[data-tile-exit]')?.focus());

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo({ top: y, behavior: 'instant' });
    };
  }, [host, open]);
}

function SortableTile({
  item,
  index,
  tiles,
  onMove,
  onHide,
}: {
  item: TileItem;
  index: number;
  tiles: TileItem[];
  onMove: (id: TileId, dir: -1 | 1) => void;
  onHide: (id: TileId) => void;
}) {
  const setSize = useTileLayoutStore((s) => s.setSize);
  const fullscreen = useTileLayoutStore((s) => s.fullscreen === item.id);
  const openFullscreen = useTileLayoutStore((s) => s.openFullscreen);
  const closeFullscreen = useTileLayoutStore((s) => s.closeFullscreen);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const Widget = TILE_WIDGETS[item.id];

  // The widget always renders into its own host element, which sits in this
  // wrapper or, while full screen, directly in <body>: a fixed element left
  // in place is trapped under the tab bar by the shell's `main` (z-10
  // stacking context). Moving the host, not the React subtree, keeps exactly
  // one instance mounted with its state (a typed task, the log form) intact.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = document.createElement('div');
    // Keeps the fleet surface's emerald accent pins on the host in <body> too.
    el.className = 'fleet-dashboard';
    setHost(el);
    return () => el.remove();
  }, []);
  useLayoutEffect(() => {
    if (!host) return;
    host.style.cssText = fullscreen ? HOST_FULLSCREEN : HOST_INLINE;
    if (fullscreen) {
      host.setAttribute('role', 'dialog');
      host.setAttribute('aria-modal', 'true');
      host.setAttribute('aria-label', `${titleOf(item.id)}, full screen`);
      host.setAttribute('data-tile-fullscreen', item.id);
      document.body.appendChild(host);
    } else {
      for (const a of ['role', 'aria-modal', 'aria-label', 'data-tile-fullscreen']) host.removeAttribute(a);
      wrapRef.current?.appendChild(host);
    }
  }, [host, fullscreen, item.id]);

  const exitFullscreen = () => {
    closeFullscreen();
    // Back to the options button that opened it, once it has rendered again.
    requestAnimationFrame(() =>
      wrapRef.current?.querySelector<HTMLElement>(`[data-tile-menu="${item.id}"]`)?.focus(),
    );
  };
  useFullscreenTile(host, fullscreen, exitFullscreen);

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        wrapRef.current = el;
      }}
      data-tile={item.id}
      className={cn(isDragging && 'relative z-40 cursor-grabbing')}
      // The wrapper keeps its height while the tile is full screen, so the group does not jump.
      style={{ height: tileHeight(item.size), transform: CSS.Translate.toString(transform), transition }}
    >
      {host &&
        createPortal(
          <Widget
            // Full screen uses the widget's roomiest layout; the stored size is unchanged.
            size={fullscreen ? 'lg' : item.size === 'tall' ? 'md-tall' : 'sm'}
            index={index}
            dragHandleProps={{ ...attributes, ...listeners }}
            tile={{
              size: item.size,
              onSize: (size) => setSize(item.id, size),
              onMoveUp: canMove(tiles, item.id, -1) ? () => onMove(item.id, -1) : undefined,
              onMoveDown: canMove(tiles, item.id, 1) ? () => onMove(item.id, 1) : undefined,
              onFullscreen: () => openFullscreen(item.id),
              onHide: () => onHide(item.id),
              fullscreen,
              onExitFullscreen: exitFullscreen,
            }}
          />,
          host,
        )}
    </div>
  );
}

export default function SidebarWidgets({ demo = false }: SidebarWidgetsProps) {
  const tiles = useTileLayoutStore((s) => s.tiles);
  const reorder = useTileLayoutStore((s) => s.reorder);
  const move = useTileLayoutStore((s) => s.move);
  const restore = useTileLayoutStore((s) => s.restore);
  const hide = useTileLayoutStore((s) => s.hide);
  const closeFullscreen = useTileLayoutStore((s) => s.closeFullscreen);

  // Demo on closes a full-screen tile (Must 8). Runs although demo renders
  // nothing below; the tile's own unmount releases the scroll lock.
  useEffect(() => {
    if (demo) closeFullscreen();
  }, [demo, closeFullscreen]);

  // Full screen survives the group moving between the column, the drawer and
  // the phone stack (the next group mounts in the same commit), but not the
  // group going away for good (a route change).
  useEffect(() => {
    mountedGroups += 1;
    return () => {
      mountedGroups -= 1;
      setTimeout(() => {
        if (mountedGroups === 0) useTileLayoutStore.getState().closeFullscreen();
      }, 0);
    };
  }, []);

  const groupRef = useRef<HTMLDivElement>(null);
  // Tile whose options button gets focus once a Move up / down or Restore has rendered.
  const focusAfterMove = useRef<TileId | 'hidden-button' | null>(null);

  const sensors = useSensors(
    // A small threshold keeps clicks on the grip from starting drags.
    useSensor(FinePointerSensor, { activationConstraint: { distance: 6 } }),
    // A short hold first, so a quick swipe that starts on the grip is not a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(() => visibleTiles(tiles), [tiles]);
  const ids = useMemo(() => visible.map((t) => t.id), [visible]);
  const hidden = useMemo(
    () => hiddenTiles(tiles).map((t) => ({ id: t.id, title: titleOf(t.id) })),
    [tiles],
  );

  // React moves the tile's DOM node to reorder it, which drops focus; put it
  // back on the moved tile's options button after the new order has painted.
  useEffect(() => {
    const id = focusAfterMove.current;
    if (!id) return;
    focusAfterMove.current = null;
    const frame = requestAnimationFrame(() => {
      const selector = id === 'hidden-button' ? '[data-hidden-tiles-toggle]' : `[data-tile-menu="${id}"]`;
      groupRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [tiles]);

  const onMove = (id: TileId, dir: -1 | 1) => {
    focusAfterMove.current = id;
    move(id, dir);
  };

  // Hide unmounts the focused menu item: focus moves to the next visible tile,
  // else the previous one, else the "Hidden tiles (n)" button.
  const onHide = (id: TileId) => {
    focusAfterMove.current = focusAfterHide(tiles, id) ?? 'hidden-button';
    hide(id);
  };

  // Focus follows the restored tile; once the control is gone (nothing left
  // hidden) it goes to the group's first tile instead of being lost.
  const onRestore = (id: TileId) => {
    focusAfterMove.current = hidden.length > 1 ? id : visible[0]?.id ?? id;
    restore(id);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    // No `over`: dropped outside the group (refused). Only tile ids are droppable here.
    if (!over || active.id === over.id || !ids.includes(over.id as TileId)) return;
    reorder(active.id as TileId, over.id as TileId);
  };

  if (demo) return null;

  return (
    <DndContext
      // A fixed id keeps the grip's `aria-describedby` the same on server and client.
      id="fleet-tiles"
      sensors={sensors}
      collisionDetection={tileCollision}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      // Only the group itself scrolls during a drag: scrolling the drawer's
      // Job tab or the page would slide the group away from the pointer and
      // turn a drop on a tile into a refused drop outside the group.
      autoScroll={{ canScroll: (el) => el.hasAttribute('data-sidebar-widgets') }}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${titleOf(active.id)} tile. Use the up and down arrow keys to move it, space to drop, escape to cancel.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${titleOf(active.id)} tile is at position ${ids.indexOf(over.id as TileId) + 1} of ${ids.length}.`
              : `${titleOf(active.id)} tile is outside the tile group.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `${titleOf(active.id)} tile dropped at position ${ids.indexOf(over.id as TileId) + 1} of ${ids.length}.`
              : `${titleOf(active.id)} tile returned to its place.`,
          onDragCancel: ({ active }) => `Move cancelled. ${titleOf(active.id)} tile returned to its place.`,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={groupRef}
          // The group scrolls inside itself (Must 6): each placement bounds its
          // height in the shell's CSS (desktop column, drawer Job tab, phone
          // stack). Tiles and the Hidden control keep their own heights.
          className="scrollbar-thin flex min-h-0 flex-col gap-3 overflow-x-hidden overflow-y-auto *:shrink-0"
          data-sidebar-widgets=""
        >
          {visible.map((item, index) => (
            <SortableTile key={item.id} item={item} index={index} tiles={tiles} onMove={onMove} onHide={onHide} />
          ))}
          <HiddenTiles tiles={hidden} onRestore={onRestore} />
        </div>
      </SortableContext>
    </DndContext>
  );
}
