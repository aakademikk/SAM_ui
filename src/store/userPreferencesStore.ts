'use client';

/**
 * SAM — User preference store.
 *
 * Owns everything the operator can bend to their will: widget layout, ambient
 * theming, background intensity, and how much attitude SAM is permitted.
 *
 * Persistence is two-tier:
 *  1. localStorage, synchronously, so a reload never flashes the default grid.
 *  2. A debounced PATCH to `/api/dashboard/layout`, so the layout follows the
 *     operator across devices. Drag events fire dozens of times a second —
 *     only the settled result is ever sent.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { arrayMove } from '@dnd-kit/sortable';

import type { AmbientTheme, WidgetKind, WidgetLayoutItem, WidgetSize } from '@/types/dashboard';
import type { SarcasmLevel } from '@/lib/personalityEngine';
import { dashboardService } from '@/lib/dashboardService';
import { clamp, debounce } from '@/lib/utils';

export const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { id: 'daily-tasks', size: 'md-tall', visible: true },
  { id: 'active-projects', size: 'md-wide', visible: true },
  { id: 'system-health', size: 'md-wide', visible: true },
];

const KNOWN_WIDGETS = new Set<WidgetKind>(DEFAULT_LAYOUT.map((w) => w.id));

/**
 * Persisted layouts outlive deploys. This drops widgets that no longer exist
 * and appends widgets shipped after the operator last saved.
 */
export function reconcileLayout(persisted: unknown): WidgetLayoutItem[] {
  if (!Array.isArray(persisted)) return [...DEFAULT_LAYOUT];

  const seen = new Set<WidgetKind>();
  const result: WidgetLayoutItem[] = [];

  for (const raw of persisted) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Partial<WidgetLayoutItem>;
    if (!item.id || !KNOWN_WIDGETS.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({
      id: item.id,
      size: (['sm', 'md-wide', 'md-tall', 'lg'] as WidgetSize[]).includes(item.size as WidgetSize)
        ? (item.size as WidgetSize)
        : 'sm',
      visible: item.visible !== false,
    });
  }

  for (const fallback of DEFAULT_LAYOUT) {
    if (!seen.has(fallback.id)) result.push({ ...fallback });
  }

  return result;
}

export type SyncState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UserPreferencesState {
  /* --- Identity ---------------------------------------------------------- */
  operatorName: string;

  /* --- Layout ------------------------------------------------------------ */
  dashboardLayout: WidgetLayoutItem[];
  editMode: boolean;

  /* --- Ambience ---------------------------------------------------------- */
  ambientTheme: AmbientTheme;
  /** 0 = background off (max battery), 1 = full neural mesh. */
  backgroundIntensity: number;
  parallaxEnabled: boolean;
  gridOverlay: boolean;

  /* --- Behaviour --------------------------------------------------------- */
  sarcasm: SarcasmLevel;
  reducedMotion: boolean;
  compactDensity: boolean;

  /* --- Sync bookkeeping -------------------------------------------------- */
  syncState: SyncState;
  lastSyncedAt: string | null;
  syncError: string | null;
  hydrated: boolean;

  /* --- Actions ----------------------------------------------------------- */
  reorderWidgets: (activeId: WidgetKind, overId: WidgetKind) => void;
  setWidgetSize: (id: WidgetKind, size: WidgetSize) => void;
  setWidgetVisible: (id: WidgetKind, visible: boolean) => void;
  resetLayout: () => void;
  setEditMode: (on: boolean) => void;

  setAmbientTheme: (theme: AmbientTheme) => void;
  setBackgroundIntensity: (value: number) => void;
  setParallaxEnabled: (on: boolean) => void;
  setGridOverlay: (on: boolean) => void;

  setSarcasm: (level: SarcasmLevel) => void;
  setReducedMotion: (on: boolean) => void;
  setCompactDensity: (on: boolean) => void;

  setOperatorName: (name: string) => void;

  flushLayoutSync: () => void;
  markHydrated: () => void;
}

/* ========================================================================== */
/* Debounced backend sync                                                     */
/* ========================================================================== */

const SYNC_DEBOUNCE_MS = 900;
let inFlight: AbortController | null = null;

async function pushLayout(layout: WidgetLayoutItem[]) {
  // Supersede any request still on the wire — only the newest layout matters.
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;

  useUserPreferencesStore.setState({ syncState: 'saving', syncError: null });

  try {
    const { savedAt } = await dashboardService.patchLayout(layout, { signal: controller.signal });
    if (controller.signal.aborted) return;
    useUserPreferencesStore.setState({
      syncState: 'saved',
      lastSyncedAt: savedAt,
      syncError: null,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    useUserPreferencesStore.setState({
      syncState: 'error',
      syncError: error instanceof Error ? error.message : 'Layout sync failed',
    });
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

const debouncedPushLayout = debounce((layout: WidgetLayoutItem[]) => {
  void pushLayout(layout);
}, SYNC_DEBOUNCE_MS);

/** Every layout mutation funnels through here so nothing forgets to sync. */
function queueLayoutSync(layout: WidgetLayoutItem[]) {
  useUserPreferencesStore.setState({ syncState: 'pending' });
  debouncedPushLayout(layout);
}

/* ========================================================================== */
/* Store                                                                      */
/* ========================================================================== */

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set, get) => ({
      operatorName: 'Operator',

      dashboardLayout: [...DEFAULT_LAYOUT],
      editMode: false,

      ambientTheme: 'toxic',
      backgroundIntensity: 0.75,
      parallaxEnabled: true,
      gridOverlay: true,

      sarcasm: 2,
      reducedMotion: false,
      compactDensity: false,

      syncState: 'idle',
      lastSyncedAt: null,
      syncError: null,
      hydrated: false,

      reorderWidgets: (activeId, overId) => {
        if (activeId === overId) return;
        const layout = get().dashboardLayout;
        const from = layout.findIndex((w) => w.id === activeId);
        const to = layout.findIndex((w) => w.id === overId);
        if (from === -1 || to === -1) return;
        const next = arrayMove(layout, from, to);
        set({ dashboardLayout: next });
        queueLayoutSync(next);
      },

      setWidgetSize: (id, size) => {
        const next = get().dashboardLayout.map((w) => (w.id === id ? { ...w, size } : w));
        set({ dashboardLayout: next });
        queueLayoutSync(next);
      },

      setWidgetVisible: (id, visible) => {
        const next = get().dashboardLayout.map((w) => (w.id === id ? { ...w, visible } : w));
        set({ dashboardLayout: next });
        queueLayoutSync(next);
      },

      resetLayout: () => {
        const next = DEFAULT_LAYOUT.map((w) => ({ ...w }));
        set({ dashboardLayout: next });
        queueLayoutSync(next);
      },

      setEditMode: (on) => set({ editMode: on }),

      setAmbientTheme: (ambientTheme) => set({ ambientTheme }),
      setBackgroundIntensity: (value) => set({ backgroundIntensity: clamp(value, 0, 1) }),
      setParallaxEnabled: (parallaxEnabled) => set({ parallaxEnabled }),
      setGridOverlay: (gridOverlay) => set({ gridOverlay }),

      setSarcasm: (sarcasm) => set({ sarcasm }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setCompactDensity: (compactDensity) => set({ compactDensity }),

      setOperatorName: (operatorName) => set({ operatorName: operatorName.trim() || 'Operator' }),

      flushLayoutSync: () => {
        debouncedPushLayout.flush(get().dashboardLayout);
      },

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'sam.preferences.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Sync bookkeeping and transient UI flags are deliberately excluded.
      partialize: (state) => ({
        operatorName: state.operatorName,
        dashboardLayout: state.dashboardLayout,
        ambientTheme: state.ambientTheme,
        backgroundIntensity: state.backgroundIntensity,
        parallaxEnabled: state.parallaxEnabled,
        gridOverlay: state.gridOverlay,
        sarcasm: state.sarcasm,
        reducedMotion: state.reducedMotion,
        compactDensity: state.compactDensity,
      }),
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<UserPreferencesState>;
        return {
          ...current,
          ...incoming,
          dashboardLayout: reconcileLayout(incoming.dashboardLayout),
        };
      },
      onRehydrateStorage: () => (state) => {
        // Runs after localStorage is applied; unblocks the grid render.
        state?.markHydrated();
      },
    },
  ),
);

/* ========================================================================== */
/* Selectors                                                                  */
/* ========================================================================== */

export const selectVisibleLayout = (s: UserPreferencesState) =>
  s.dashboardLayout.filter((w) => w.visible);

export const selectWidgetSize = (id: WidgetKind) => (s: UserPreferencesState) =>
  s.dashboardLayout.find((w) => w.id === id)?.size ?? 'sm';

export const selectHiddenCount = (s: UserPreferencesState) =>
  s.dashboardLayout.filter((w) => !w.visible).length;
