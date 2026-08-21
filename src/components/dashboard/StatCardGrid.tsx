'use client';

/**
 * SAM — Dashboard layout engine.
 *
 * A four-column CSS grid driven by `@dnd-kit`. Widgets declare a footprint
 * (1×1 / 2×1 / 1×2 / 2×2); the grid places them, and drag-to-reorder snaps to
 * cell boundaries because the sortable list *is* the grid order — there are no
 * free-floating coordinates to round.
 *
 * Every reorder and resize writes straight to `userPreferencesStore`, which
 * persists locally and debounces a PATCH to the backend.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, LayoutGrid } from 'lucide-react';

import type { WidgetKind, WidgetSize } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WIDGET_REGISTRY } from '@/components/dashboard/widgetRegistry';
import { GridSkeleton } from '@/components/ui/Skeleton';

/**
 * Footprint → grid spans. The base grid is single-column, so small screens
 * stack everything and only the wider breakpoints honour the 2-column spans.
 */
const SPAN_CLASS: Record<WidgetSize, string> = {
  sm: 'col-span-1 row-span-1',
  'md-wide': 'col-span-1 sm:col-span-2 row-span-1',
  'md-tall': 'col-span-1 row-span-2',
  lg: 'col-span-1 sm:col-span-2 row-span-2',
};

/* ========================================================================== */
/* Sortable cell                                                              */
/* ========================================================================== */

function SortableWidget({
  id,
  size,
  index,
}: {
  id: WidgetKind;
  size: WidgetSize;
  index: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    // Surfaced to collision detection so neighbours reflow correctly.
    data: { size },
  });

  const descriptor = WIDGET_REGISTRY[id];
  const Widget = descriptor.component;

  return (
    <div
      ref={setNodeRef}
      className={cn('min-h-0', SPAN_CLASS[size], isDragging && 'z-30')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <Widget
        size={size}
        index={index}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/* ========================================================================== */
/* Hidden tray                                                                */
/* ========================================================================== */

function HiddenWidgetsTray({ hidden }: { hidden: WidgetKind[] }) {
  const setWidgetVisible = useUserPreferencesStore((s) => s.setWidgetVisible);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="glass mt-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2.5">
        <span className="label flex items-center gap-1.5">
          <LayoutGrid size={11} />
          Hidden ({hidden.length})
        </span>

        {hidden.map((id) => {
          const descriptor = WIDGET_REGISTRY[id];
          const Icon = descriptor.icon;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setWidgetVisible(id, true)}
              title={descriptor.description}
              className="group flex items-center gap-1.5 rounded-[4px] border border-void-400/60 bg-void-700/50 px-2 py-1 text-[10.5px] text-slate-400 transition-colors hover:border-[var(--sam-accent)]/50 hover:bg-void-600/60 hover:text-slate-100"
            >
              <Icon size={11} />
              {descriptor.title}
              <Eye size={10} className="opacity-0 transition-opacity group-hover:opacity-70" />
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ========================================================================== */
/* Grid                                                                       */
/* ========================================================================== */

export function StatCardGrid() {
  const layout = useUserPreferencesStore((s) => s.dashboardLayout);
  const hydrated = useUserPreferencesStore((s) => s.hydrated);
  const reorderWidgets = useUserPreferencesStore((s) => s.reorderWidgets);
  const compactDensity = useUserPreferencesStore((s) => s.compactDensity);

  const [activeId, setActiveId] = useState<WidgetKind | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small threshold keeps clicks on menus and buttons from starting drags.
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(() => layout.filter((w) => w.visible), [layout]);
  const hidden = useMemo(() => layout.filter((w) => !w.visible).map((w) => w.id), [layout]);
  const ids = useMemo(() => visible.map((w) => w.id), [visible]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as WidgetKind);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over || active.id === over.id) return;
      reorderWidgets(active.id as WidgetKind, over.id as WidgetKind);
    },
    [reorderWidgets],
  );

  // Persisted layout arrives asynchronously; showing the default grid first and
  // swapping would flash the wrong arrangement.
  if (!hydrated) return <GridSkeleton count={8} />;

  const activeDescriptor = activeId ? WIDGET_REGISTRY[activeId] : null;
  const activeSize = activeId ? (visible.find((w) => w.id === activeId)?.size ?? 'sm') : 'sm';
  const ActiveWidget = activeDescriptor?.component;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
      modifiers={[restrictToWindowEdges]}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${WIDGET_REGISTRY[active.id as WidgetKind].title}. Use arrow keys to move, space to drop.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${WIDGET_REGISTRY[active.id as WidgetKind].title} is over ${WIDGET_REGISTRY[over.id as WidgetKind].title}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `${WIDGET_REGISTRY[active.id as WidgetKind].title} dropped at position ${
                  ids.indexOf(over.id as WidgetKind) + 1
                } of ${ids.length}.`
              : `${WIDGET_REGISTRY[active.id as WidgetKind].title} returned to its original position.`,
          onDragCancel: ({ active }) =>
            `Reorder cancelled. ${WIDGET_REGISTRY[active.id as WidgetKind].title} returned.`,
        },
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div
          className={cn(
            // Dense flow backfills the holes that 1×2 and 2×2 footprints leave
            // behind; without it a tall widget strands an empty cell beside it.
            'grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
            compactDensity
              ? 'auto-rows-[minmax(148px,auto)] gap-3'
              : 'auto-rows-[minmax(178px,auto)] gap-4',
          )}
        >
          {visible.map((widget, index) => (
            <SortableWidget key={widget.id} id={widget.id} size={widget.size} index={index} />
          ))}
        </div>
      </SortableContext>

      <AnimatePresence>{hidden.length > 0 && <HiddenWidgetsTray hidden={hidden} />}</AnimatePresence>

      {/* The lifted card, rendered in a portal-free overlay above the grid. */}
      <DragOverlay dropAnimation={{ duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
        {ActiveWidget && (
          <div
            className="h-full cursor-grabbing"
            style={{
              // Approximate the source footprint so the overlay is not a
              // different shape from the hole it left behind.
              width: '100%',
              minHeight: activeSize === 'md-tall' || activeSize === 'lg' ? 360 : 178,
            }}
          >
            <ActiveWidget size={activeSize} index={0} isOverlay />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
