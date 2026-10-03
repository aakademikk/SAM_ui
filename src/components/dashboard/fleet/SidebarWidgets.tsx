'use client';

/**
 * SAM — carried-over Dashboard widgets (T15, Must 3b; check 22).
 *
 * System Health, Daily Tasks and Money In from today's Dashboard
 * (`src/components/dashboard/widgets/`), imported and mounted unchanged,
 * outside `StatCardGrid`'s `dnd-kit` machinery — they are not draggable or
 * resizable from here, just present. `ActiveProjectsWidget` is dropped
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
 * Footprint: pinned to `sm` (the compact view — gauge / headline open count
 * / headline total, still the real figures) regardless of whatever size a
 * widget is set to on `/classic` (same `userPreferencesStore`, but the size
 * prop passed here is fixed, not read from it). A narrow sidebar column
 * (beside the floor, the drawer's Job tab, or under the phone's job in
 * flight) cannot safely absorb an arbitrary carried-over `lg`/`md-tall`
 * footprint without risking the kind of overflow Must 5/the 1920 fit (T11)
 * guards against, so the size here does not follow the saved layout. The
 * ellipsis menu's own resize/hide controls are untouched (they are part of
 * the widget, unchanged) and still write to that shared store if used here
 * — that affects `/classic`'s layout too, exactly as it would if two tabs
 * of `/classic` were open at once; this is existing, unmodified behaviour.
 *
 * Demo mode (Must 19): renders nothing. The simplest way to guarantee no
 * live task, amount or health detail ever reaches the screen in demo mode;
 * T20 wires the `demo` switch into the view, T21 scans it.
 */

import { DailyTasksWidget } from '@/components/dashboard/widgets/DailyTasksWidget';
import { MoneyInWidget } from '@/components/dashboard/widgets/MoneyInWidget';
import { SystemHealthWidget } from '@/components/dashboard/widgets/SystemHealthWidget';

export interface SidebarWidgetsProps {
  /** Demo mode (T20): hides these widgets rather than showing live figures (Must 19). */
  demo?: boolean;
}

/** The `sm` footprint's usual grid row height (`StatCardGrid`'s `auto-rows-[minmax(178px,auto)]`) — these widgets live outside that grid, so it is set explicitly here. */
const WIDGET_HEIGHT = 176;

export default function SidebarWidgets({ demo = false }: SidebarWidgetsProps) {
  if (demo) return null;

  return (
    <div className="flex flex-col gap-3" data-sidebar-widgets="">
      <div style={{ height: WIDGET_HEIGHT }}>
        <SystemHealthWidget size="sm" index={0} />
      </div>
      <div style={{ height: WIDGET_HEIGHT }}>
        <DailyTasksWidget size="sm" index={1} />
      </div>
      <div style={{ height: WIDGET_HEIGHT }}>
        <MoneyInWidget size="sm" index={2} />
      </div>
    </div>
  );
}
