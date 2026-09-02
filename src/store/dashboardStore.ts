'use client';

/**
 * SAM — Live dashboard store.
 *
 * Holds one slice per data domain, each with its own load state, error and
 * freshness stamp so a single failing endpoint degrades one widget instead of
 * the whole console. Polling cadence is per-slice and pauses while the tab is
 * hidden — SAM does not bill you for telemetry nobody is looking at.
 */

import { create } from 'zustand';

import type {
  DailyTask,
  DailyTasksPayload,
  LoadState,
  MoneyEntry,
  MoneyInPayload,
  Project,
  SystemHealthPayload,
  TaskPriority,
} from '@/types/dashboard';
import { ApiError, dashboardService } from '@/lib/dashboardService';
import { uid } from '@/lib/utils';

/* ========================================================================== */
/* Slice plumbing                                                             */
/* ========================================================================== */

export interface Slice<T> {
  data: T | null;
  status: LoadState;
  error: string | null;
  updatedAt: number | null;
  /** Consecutive failures; drives the "SAM is annoyed" affordances. */
  failures: number;
}

const emptySlice = <T>(): Slice<T> => ({
  data: null,
  status: 'idle',
  error: null,
  updatedAt: null,
  failures: 0,
});

export type SliceKey = 'projects' | 'system' | 'tasks' | 'money';

/** Polling cadence per slice, in milliseconds. */
export const POLL_INTERVALS: Record<SliceKey, number> = {
  system: 4_000,
  tasks: 30_000,
  projects: 30_000,
  money: 30_000,
};

const controllers = new Map<SliceKey, AbortController>();
const timers = new Map<SliceKey, ReturnType<typeof setInterval>>();
let visibilityBound = false;

function nextController(key: SliceKey) {
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  return controller;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 0 ? 'Network unreachable' : `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : 'Unknown failure';
}

/** Local calendar day as YYYY-MM-DD, matching the server's money-store clock. */
function localDayStr(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM` prefix — month arithmetic on stored dates. */
function monthKey(date: string): string {
  return date.slice(0, 7);
}

/* ========================================================================== */
/* State                                                                      */
/* ========================================================================== */

export interface DashboardState {
  projects: Slice<Project[]>;
  system: Slice<SystemHealthPayload>;
  tasks: Slice<DailyTasksPayload>;
  money: Slice<MoneyInPayload>;

  /** True until the first bootstrap settles. Drives the skeleton cascade. */
  booting: boolean;
  polling: boolean;
  lastTick: number | null;

  /* --- Fetching ---------------------------------------------------------- */
  refresh: (key: SliceKey) => Promise<void>;
  bootstrap: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;

  /* --- Mutations --------------------------------------------------------- */
  addTask: (title: string, priority?: TaskPriority, tag?: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addMoneyEntry: (input: {
    label: string;
    amount: number;
    date?: string;
    source?: string;
    recurring?: boolean;
  }) => Promise<void>;
  deleteMoneyEntry: (id: string) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  projects: emptySlice(),
  system: emptySlice(),
  tasks: emptySlice(),
  money: emptySlice(),

  booting: true,
  polling: false,
  lastTick: null,

  /* ---------------------------------------------------------------------- */

  refresh: async (key) => {
    const controller = nextController(key);
    const signal = controller.signal;

    set((state) => ({
      [key]: { ...state[key], status: state[key].data ? 'ready' : 'loading', error: null },
    }) as Partial<DashboardState>);

    try {
      let data: unknown;
      switch (key) {
        case 'projects':
          data = await dashboardService.getProjects({ signal });
          break;
        case 'system':
          data = await dashboardService.getSystemHealth({ signal });
          break;
        case 'tasks':
          data = await dashboardService.getTasks({ signal });
          break;
        case 'money':
          data = await dashboardService.getMoney({ signal });
          break;
      }

      if (signal.aborted) return;

      set(() => ({
        [key]: {
          data,
          status: 'ready' as LoadState,
          error: null,
          updatedAt: Date.now(),
          failures: 0,
        },
        lastTick: Date.now(),
      }) as unknown as Partial<DashboardState>);
    } catch (error) {
      if (signal.aborted) return;
      set((state) => ({
        [key]: {
          ...state[key],
          status: 'error' as LoadState,
          error: describeError(error),
          failures: state[key].failures + 1,
        },
      }) as unknown as Partial<DashboardState>);
    }
  },

  bootstrap: async () => {
    set({ booting: true });
    const keys: SliceKey[] = ['system', 'tasks', 'projects', 'money'];
    // Settle everything, then lift the boot curtain once — a partial estate is
    // still worth rendering.
    await Promise.allSettled(keys.map((key) => get().refresh(key)));
    set({ booting: false });
  },

  startPolling: () => {
    if (get().polling) return;
    set({ polling: true });

    for (const key of Object.keys(POLL_INTERVALS) as SliceKey[]) {
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void get().refresh(key);
      }, POLL_INTERVALS[key]);
      timers.set(key, interval);
    }

    if (typeof document !== 'undefined' && !visibilityBound) {
      visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        // Catch up immediately when the operator comes back.
        if (document.visibilityState === 'visible' && useDashboardStore.getState().polling) {
          void useDashboardStore.getState().refresh('system');
        }
      });
    }
  },

  stopPolling: () => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    set({ polling: false });
  },

  /* ---------------------------------------------------------------------- */

  addTask: async (title, priority = 'p2', tag = 'general') => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const current = get().tasks.data;
    const optimisticTask: DailyTask = {
      id: uid('task'),
      title: trimmed,
      done: false,
      priority,
      tag,
      dueAt: null,
      createdAt: new Date().toISOString(),
      origin: 'operator',
    };

    if (current) {
      set((s) => ({
        tasks: { ...s.tasks, data: { ...current, tasks: [optimisticTask, ...current.tasks] } },
      }));
    }

    try {
      const data = await dashboardService.createTask({ title: trimmed, priority, tag });
      set((s) => ({ tasks: { ...s.tasks, data, updatedAt: Date.now(), error: null } }));
    } catch (error) {
      set((s) => ({ tasks: { ...s.tasks, data: current, error: describeError(error) } }));
    }
  },

  toggleTask: async (id) => {
    const current = get().tasks.data;
    if (!current) return;
    const target = current.tasks.find((t) => t.id === id);
    if (!target) return;

    const optimistic: DailyTasksPayload = {
      ...current,
      tasks: current.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
      completedToday: current.completedToday + (target.done ? -1 : 1),
    };
    set((s) => ({ tasks: { ...s.tasks, data: optimistic } }));

    try {
      const data = await dashboardService.updateTask(id, { done: !target.done });
      set((s) => ({ tasks: { ...s.tasks, data, updatedAt: Date.now(), error: null } }));
    } catch (error) {
      set((s) => ({ tasks: { ...s.tasks, data: current, error: describeError(error) } }));
    }
  },

  deleteTask: async (id) => {
    const current = get().tasks.data;
    if (!current) return;

    set((s) => ({
      tasks: {
        ...s.tasks,
        data: { ...current, tasks: current.tasks.filter((t) => t.id !== id) },
      },
    }));

    try {
      const data = await dashboardService.deleteTask(id);
      set((s) => ({ tasks: { ...s.tasks, data, updatedAt: Date.now(), error: null } }));
    } catch (error) {
      set((s) => ({ tasks: { ...s.tasks, data: current, error: describeError(error) } }));
    }
  },

  addMoneyEntry: async ({ label, amount, date, source, recurring = false }) => {
    const trimmed = label.trim();
    if (!trimmed || !Number.isFinite(amount) || amount <= 0) return;

    const current = get().money.data;
    const entryDate = date ?? localDayStr(new Date());
    const optimisticEntry: MoneyEntry = {
      id: uid('money'),
      label: trimmed,
      amount,
      date: entryDate,
      source: (source ?? '').trim(),
      recurring,
      createdAt: new Date().toISOString(),
    };

    if (current) {
      // Recurring entries count from their start month onward; keep the
      // optimistic totals honest until the server round-trip corrects them.
      const thisKey = monthKey(localDayStr(new Date()));
      const start = entryDate.slice(0, 7);
      const countsThisMonth = recurring ? start <= thisKey : start === thisKey;

      const optimistic: MoneyInPayload = {
        ...current,
        entries: [optimisticEntry, ...current.entries],
        totalThisMonth: current.totalThisMonth + (countsThisMonth ? amount : 0),
        countThisMonth: current.countThisMonth + (countsThisMonth ? 1 : 0),
      };
      set((s) => ({ money: { ...s.money, data: optimistic } }));
    }

    try {
      const data = await dashboardService.createMoneyEntry({
        label: trimmed,
        amount,
        date: entryDate,
        source: source?.trim(),
        recurring,
      });
      set((s) => ({ money: { ...s.money, data, updatedAt: Date.now(), error: null } }));
    } catch (error) {
      set((s) => ({ money: { ...s.money, data: current, error: describeError(error) } }));
    }
  },

  deleteMoneyEntry: async (id) => {
    const current = get().money.data;
    if (!current) return;
    const target = current.entries.find((e) => e.id === id);
    if (!target) return;

    // Only unwind the current-month totals if the entry was counting this month.
    const thisKey = monthKey(localDayStr(new Date()));
    const counted = target.recurring
      ? monthKey(target.date) <= thisKey
      : monthKey(target.date) === thisKey;

    set((s) => ({
      money: {
        ...s.money,
        data: {
          ...current,
          entries: current.entries.filter((e) => e.id !== id),
          totalThisMonth: Math.max(0, current.totalThisMonth - (counted ? target.amount : 0)),
          countThisMonth: Math.max(0, current.countThisMonth - (counted ? 1 : 0)),
        },
      },
    }));

    try {
      const data = await dashboardService.deleteMoneyEntry(id);
      set((s) => ({ money: { ...s.money, data, updatedAt: Date.now(), error: null } }));
    } catch (error) {
      set((s) => ({ money: { ...s.money, data: current, error: describeError(error) } }));
    }
  },
}));

/* ========================================================================== */
/* Selectors                                                                  */
/* ========================================================================== */

export const selectAnyError = (state: DashboardState) => {
  const keys: SliceKey[] = ['projects', 'system', 'tasks', 'money'];
  return keys.some((k) => state[k].status === 'error');
};

export const selectSliceStatus = (key: SliceKey) => (state: DashboardState) => state[key].status;
