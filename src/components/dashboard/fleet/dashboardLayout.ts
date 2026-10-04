/**
 * SAM — fleet dashboard layout and panel state (T11).
 *
 * The pure half of `FleetDashboardShell`: which layout a viewport gets and
 * which side panel is open. Kept free of the DOM so it can be tested
 * headlessly (`dashboardLayout.test.ts`); the shell's CSS uses the same
 * query strings exported here, so the drawn layout and this logic cannot
 * drift apart.
 *
 * Breakpoints, all from the design source's `e-hybrid.html`:
 * - drawer (small laptop, Must 5): `(min-width:820px) and (max-width:1600px),
 *   (min-width:820px) and (max-height:800px)` — the six side modules fold
 *   into one tabbed drawer on the right, Job tab open by default. This is
 *   `LAPTOP_QUERY` from `floorRender.ts` (T7), which also picks the floor's
 *   laptop scene options, so the two always agree.
 * - drawer, taller laptop: `(min-width:820px) and (max-width:1600px) and
 *   (min-height:820px)` — Job detail and Fleet status show together under
 *   the Job tab, and the Fleet tab button is hidden.
 * - compact desktop: `(max-width:1700px),(max-height:980px)` — the full
 *   layout with narrower columns and a shorter bottom row (1440x900-class
 *   screens that miss the drawer).
 * - phone: `(max-width:819px),(pointer:coarse) and (max-height:559px)` —
 *   T13's `FleetView` sends these to the phone layout; this shell reports it
 *   but does not draw the phone layout itself.
 * At 1920x1080 and larger none apply: the recorded desktop layout.
 */

import { useEffect, useState } from 'react';

import { LAPTOP_QUERY } from '@/components/floor/floorRender';
import type { GeneralId } from '@/types/floor';

/* ---------- breakpoints ---------- */

export const DRAWER_QUERY = LAPTOP_QUERY;
export const DRAWER_TALL_QUERY = '(min-width:820px) and (max-width:1600px) and (min-height:820px)';
export const COMPACT_QUERY = '(max-width:1700px),(max-height:980px)';
/** "Under 560 px tall" (Must 6c), so 559 inclusive; T13's `FleetView` gates on this exact string. */
export const PHONE_QUERY = '(max-width:819px),(pointer:coarse) and (max-height:559px)';

/* ---------- the drawer's tabs ---------- */

export type DrawerTab = 'detail' | 'fleet' | 'jobs' | 'events' | 'spend' | 'chat';

/** The mockup's six tabs, in its order and with its labels. */
export const DRAWER_TABS: readonly { id: DrawerTab; label: string }[] = [
  { id: 'detail', label: 'Job' },
  { id: 'fleet', label: 'Fleet' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'events', label: 'Events' },
  { id: 'spend', label: 'Spend' },
  { id: 'chat', label: 'Chat' },
];

export const DEFAULT_TAB: DrawerTab = 'detail';

/* ---------- layout ---------- */

export type LayoutMode = 'full' | 'drawer';

export interface DashboardLayout {
  /** 'drawer': the floor plus one tabbed drawer; 'full': the floor with all six modules around it. */
  mode: LayoutMode;
  /** Drawer on a taller laptop: Job detail and Fleet status share the Job tab. */
  drawerTall: boolean;
  /** Full layout with the mockup's narrower 1440-class columns. */
  compact: boolean;
  /** A phone-sized viewport (T13 routes these to the phone layout). */
  phone: boolean;
  defaultTab: DrawerTab;
  /** The tab buttons shown (all six, less Fleet on a taller laptop, as in the mockup). */
  visibleTabs: DrawerTab[];
  /** FloorCanvas's scene options to use. */
  floorVariant: 'desktop' | 'laptop';
}

/**
 * The layout for a viewport of `width` x `height` CSS px, mirroring the
 * media queries above exactly (CSS `max-width:1600px` includes 1600).
 */
export function dashboardLayout(width: number, height: number, opts: { coarse?: boolean } = {}): DashboardLayout {
  const wide = width >= 820;
  const drawer = wide && (width <= 1600 || height <= 800);
  const drawerTall = wide && width <= 1600 && height >= 820;
  const compact = width <= 1700 || height <= 980;
  const phone = width <= 819 || (!!opts.coarse && height <= 559);
  return {
    mode: drawer ? 'drawer' : 'full',
    drawerTall,
    compact,
    phone,
    defaultTab: DEFAULT_TAB,
    visibleTabs: DRAWER_TABS.map((t) => t.id).filter((id) => !(drawerTall && id === 'fleet')),
    floorVariant: drawer ? 'laptop' : 'desktop',
  };
}

/** The viewport's layout, kept current on resize; null until mounted (the CSS has already laid the page out by then). */
export function useDashboardLayout(): DashboardLayout | null {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer:coarse)');
    const update = () => {
      const next = dashboardLayout(window.innerWidth, window.innerHeight, { coarse: coarse.matches });
      setLayout((prev) => (prev && sameLayout(prev, next) ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return layout;
}

function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return a.mode === b.mode && a.drawerTall === b.drawerTall && a.compact === b.compact && a.phone === b.phone;
}

/* ---------- the one open side panel ---------- */

/**
 * At most one side panel is open at a time: a General's detail, or (T18)
 * the Schedule panel opened from the clock ring — never both, same as the
 * mockup's `E.setFocus` override in `e-scene.js`'s `EScene.schedule`
 * ("if (open) setOpen(false); sf(id)"): opening one closes the other first.
 */
export type OpenPanel = { kind: 'general'; id: GeneralId } | { kind: 'schedule' } | null;

export interface PanelState {
  /** The drawer's selected tab (kept while a panel is open, so closing returns to it). */
  tab: DrawerTab;
  open: OpenPanel;
}

export type PanelAction =
  | { type: 'openGeneral'; id: GeneralId }
  /** The ring's click target (T18, Must 26). */
  | { type: 'openSchedule' }
  | { type: 'close' }
  | { type: 'tab'; tab: DrawerTab }
  /** A click on the floor: a General (station, card or pads) opens it; empty floor closes. */
  | { type: 'floorClick'; hit: GeneralId | null }
  /** A job was picked (an Active jobs row or a worker figure): close any panel and show the Job tab. */
  | { type: 'selectJob' };

export const INITIAL_PANEL_STATE: PanelState = { tab: DEFAULT_TAB, open: null };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'openGeneral':
      if (state.open?.kind === 'general' && state.open.id === action.id) return state;
      return { ...state, open: { kind: 'general', id: action.id } };
    case 'openSchedule':
      if (state.open?.kind === 'schedule') return state;
      return { ...state, open: { kind: 'schedule' } };
    case 'close':
      return state.open ? { ...state, open: null } : state;
    case 'tab':
      // picking a tab closes any open detail (the mockup's tab click calls setFocus(null))
      if (state.tab === action.tab && !state.open) return state;
      return { tab: action.tab, open: null };
    case 'floorClick':
      return action.hit ? panelReducer(state, { type: 'openGeneral', id: action.hit }) : panelReducer(state, { type: 'close' });
    case 'selectJob':
      if (state.tab === 'detail' && !state.open) return state;
      return { tab: 'detail', open: null };
  }
}
