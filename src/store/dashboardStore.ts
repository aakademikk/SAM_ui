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
  AgentFleetPayload,
  ChatMessage,
  DailyTask,
  DailyTasksPayload,
  FinancePayload,
  Insight,
  LoadState,
  Project,
  SamMood,
  Severity,
  SystemHealthPayload,
  TaskPriority,
  TerminalLine,
  TerminalStreamKind,
  VaultMemoryPayload,
} from '@/types/dashboard';
import type { SamContext } from '@/lib/personalityEngine';
import { ApiError, dashboardService } from '@/lib/dashboardService';
import { uid } from '@/lib/utils';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';

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

export type SliceKey =
  | 'insights'
  | 'fleet'
  | 'vault'
  | 'projects'
  | 'system'
  | 'finance'
  | 'tasks';

/** Polling cadence per slice, in milliseconds. */
export const POLL_INTERVALS: Record<SliceKey, number> = {
  system: 4_000,
  fleet: 5_000,
  vault: 12_000,
  insights: 20_000,
  tasks: 30_000,
  projects: 30_000,
  finance: 60_000,
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

/* ========================================================================== */
/* State                                                                      */
/* ========================================================================== */

export interface DashboardState {
  insights: Slice<Insight[]>;
  fleet: Slice<AgentFleetPayload>;
  vault: Slice<VaultMemoryPayload>;
  projects: Slice<Project[]>;
  system: Slice<SystemHealthPayload>;
  finance: Slice<FinancePayload>;
  tasks: Slice<DailyTasksPayload>;

  /** True until the first bootstrap settles. Drives the skeleton cascade. */
  booting: boolean;
  polling: boolean;
  lastTick: number | null;

  terminal: {
    lines: TerminalLine[];
    history: string[];
    running: boolean;
    cwd: string;
  };

  chat: {
    messages: ChatMessage[];
    sending: boolean;
    error: string | null;
  };

  mood: SamMood;
  moodPinnedUntil: number;

  /* --- Fetching ---------------------------------------------------------- */
  refresh: (key: SliceKey) => Promise<void>;
  bootstrap: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;

  /* --- Mutations --------------------------------------------------------- */
  acknowledgeInsight: (id: string) => Promise<void>;
  commandAgent: (id: string, action: 'pause' | 'resume' | 'kill' | 'boost') => Promise<void>;
  queryVault: (query: string) => Promise<void>;
  addTask: (title: string, priority?: TaskPriority, tag?: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  /* --- Terminal ---------------------------------------------------------- */
  runCommand: (command: string) => Promise<void>;
  pushTerminalLine: (kind: TerminalStreamKind, text: string) => void;
  clearTerminal: () => void;

  /* --- Chat -------------------------------------------------------------- */
  sendChat: (text: string) => Promise<void>;
  resetChat: () => void;

  /* --- Affect ------------------------------------------------------------ */
  setMood: (mood: SamMood, holdMs?: number) => void;
}

const BOOT_LINES: { kind: TerminalStreamKind; text: string }[] = [
  { kind: 'system', text: 'SAM shell v4.2.1 — supervisor context attached' },
  { kind: 'system', text: 'runtimes: n8n · docker · python3.12 · vault-cli' },
  { kind: 'sam', text: "Type `help` if you have forgotten what you're doing. It happens." },
];

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  insights: emptySlice(),
  fleet: emptySlice(),
  vault: emptySlice(),
  projects: emptySlice(),
  system: emptySlice(),
  finance: emptySlice(),
  tasks: emptySlice(),

  booting: true,
  polling: false,
  lastTick: null,

  terminal: {
    lines: BOOT_LINES.map((line, i) => ({
      id: `boot_${i}`,
      kind: line.kind,
      text: line.text,
      at: 0,
    })),
    history: [],
    running: false,
    cwd: '~/atwood',
  },

  chat: {
    messages: [],
    sending: false,
    error: null,
  },

  mood: 'idle',
  moodPinnedUntil: 0,

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
        case 'insights':
          data = await dashboardService.getInsights({ signal });
          break;
        case 'fleet':
          data = await dashboardService.getFleet({ signal });
          break;
        case 'vault':
          data = await dashboardService.getVault({ signal });
          break;
        case 'projects':
          data = await dashboardService.getProjects({ signal });
          break;
        case 'system':
          data = await dashboardService.getSystemHealth({ signal });
          break;
        case 'finance':
          data = await dashboardService.getFinance('30d', { signal });
          break;
        case 'tasks':
          data = await dashboardService.getTasks({ signal });
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
    const keys: SliceKey[] = ['system', 'fleet', 'insights', 'tasks', 'vault', 'projects', 'finance'];
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
          void useDashboardStore.getState().refresh('fleet');
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

  acknowledgeInsight: async (id) => {
    const current = get().insights.data;
    if (!current) return;

    // Optimistic: the row dims instantly, reconciles on the server response.
    const optimistic = current.map((i) => (i.id === id ? { ...i, acknowledged: true } : i));
    set((s) => ({ insights: { ...s.insights, data: optimistic } }));

    try {
      const data = await dashboardService.acknowledgeInsight(id);
      set((s) => ({ insights: { ...s.insights, data, updatedAt: Date.now(), error: null } }));
    } catch (error) {
      set((s) => ({
        insights: { ...s.insights, data: current, error: describeError(error) },
      }));
    }
  },

  commandAgent: async (id, action) => {
    get().setMood(action === 'kill' ? 'annoyed' : 'thinking', 2200);
    try {
      const data = await dashboardService.commandAgent(id, action);
      set((s) => ({ fleet: { ...s.fleet, data, updatedAt: Date.now(), error: null, failures: 0 } }));
    } catch (error) {
      set((s) => ({ fleet: { ...s.fleet, error: describeError(error) } }));
    }
  },

  queryVault: async (query) => {
    if (!query.trim()) return;
    get().setMood('thinking', 1600);
    try {
      const data = await dashboardService.queryVault(query.trim());
      set((s) => ({ vault: { ...s.vault, data, updatedAt: Date.now(), error: null, failures: 0 } }));
    } catch (error) {
      set((s) => ({ vault: { ...s.vault, error: describeError(error) } }));
    }
  },

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

  /* ---------------------------------------------------------------------- */

  pushTerminalLine: (kind, text) => {
    set((s) => ({
      terminal: {
        ...s.terminal,
        // Bound the scrollback; a runaway job should not eat the heap.
        lines: [...s.terminal.lines, { id: uid('line'), kind, text, at: Date.now() }].slice(-400),
      },
    }));
  },

  clearTerminal: () => {
    set((s) => ({ terminal: { ...s.terminal, lines: [] } }));
  },

  runCommand: async (command) => {
    const trimmed = command.trim();
    if (!trimmed || get().terminal.running) return;

    const { cwd } = get().terminal;
    get().pushTerminalLine('stdin', `${cwd} $ ${trimmed}`);

    if (trimmed === 'clear' || trimmed === 'cls') {
      get().clearTerminal();
      set((s) => ({ terminal: { ...s.terminal, history: [trimmed, ...s.terminal.history].slice(0, 60) } }));
      return;
    }

    set((s) => ({
      terminal: {
        ...s.terminal,
        running: true,
        history: [trimmed, ...s.terminal.history.filter((h) => h !== trimmed)].slice(0, 60),
      },
    }));
    get().setMood('thinking', 1500);

    try {
      const result = await dashboardService.execCommand(trimmed);
      for (const line of result.lines) get().pushTerminalLine(line.kind, line.text);
      if (result.remark) get().pushTerminalLine('sam', result.remark);
      get().setMood(result.ok ? 'pleased' : 'annoyed', 2600);

      // Commands mutate the estate; pull the affected surfaces back in.
      if (/docker|restart|deploy|n8n|workflow/i.test(trimmed)) {
        void get().refresh('system');
        void get().refresh('projects');
      }
      if (/agent|swarm|spawn|kill/i.test(trimmed)) void get().refresh('fleet');
      if (/vault|index|reindex/i.test(trimmed)) void get().refresh('vault');
    } catch (error) {
      get().pushTerminalLine('stderr', `sam: ${describeError(error)}`);
      get().setMood('alert', 3000);
    } finally {
      set((s) => ({ terminal: { ...s.terminal, running: false } }));
    }
  },

  /* ---------------------------------------------------------------------- */

  sendChat: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().chat.sending) return;

    const userMessage: ChatMessage = {
      id: uid('msg'),
      role: 'user',
      content: trimmed,
      at: Date.now(),
    };

    const replyId = uid('msg');
    const placeholder: ChatMessage = {
      id: replyId,
      role: 'sam',
      content: '',
      at: Date.now(),
      streaming: true,
    };

    set((s) => ({
      chat: {
        ...s.chat,
        messages: [...s.chat.messages, userMessage, placeholder],
        sending: true,
        error: null,
      },
    }));
    get().setMood('thinking');

    const history = get()
      .chat.messages.filter((m) => !m.streaming)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    const { sarcasm } = useUserPreferencesStore.getState();

    try {
      let accumulated = '';
      let firstChunk = true;

      for await (const chunk of dashboardService.streamChat(
        [...history, { role: 'user', content: trimmed }],
        { context: selectSamContext(get()), sarcasm },
      )) {
        accumulated += chunk;
        if (firstChunk) {
          firstChunk = false;
          get().setMood('speaking');
        }
        set((s) => ({
          chat: {
            ...s.chat,
            messages: s.chat.messages.map((m) =>
              m.id === replyId ? { ...m, content: accumulated } : m,
            ),
          },
        }));
      }

      set((s) => ({
        chat: {
          ...s.chat,
          sending: false,
          messages: s.chat.messages.map((m) =>
            m.id === replyId ? { ...m, streaming: false, content: accumulated } : m,
          ),
        },
      }));
      get().setMood('idle', 900);
    } catch (error) {
      const message = describeError(error);
      set((s) => ({
        chat: {
          ...s.chat,
          sending: false,
          error: message,
          messages: s.chat.messages.map((m) =>
            m.id === replyId
              ? {
                  ...m,
                  streaming: false,
                  severity: 'critical' as Severity,
                  content: `My own backend just refused to answer me. ${message}. Fix your infrastructure and ask again.`,
                }
              : m,
          ),
        },
      }));
      get().setMood('alert', 4000);
    }
  },

  resetChat: () => set((s) => ({ chat: { ...s.chat, messages: [], error: null } })),

  /* ---------------------------------------------------------------------- */

  setMood: (mood, holdMs = 0) => {
    const now = Date.now();
    // A pinned alarm outranks routine mood changes until it expires.
    if (now < get().moodPinnedUntil && mood === 'idle') return;
    set({ mood, moodPinnedUntil: holdMs > 0 ? now + holdMs : 0 });
  },
}));

/* ========================================================================== */
/* Selectors                                                                  */
/* ========================================================================== */

/** Snapshot handed to the personality engine so replies cite real numbers. */
export function selectSamContext(state: DashboardState): SamContext {
  const agents = state.fleet.data?.agents ?? [];
  const insights = state.insights.data ?? [];
  const projects = state.projects.data ?? [];

  return {
    operator: useUserPreferencesStore.getState().operatorName,
    systemScore: state.system.data?.overallScore ?? 0,
    agentsExecuting: agents.filter((a) => a.status === 'executing').length,
    agentsTotal: agents.length,
    blockedAgents: agents.filter((a) => a.status === 'blocked').length,
    criticalInsights: insights.filter((i) => i.severity === 'critical' && !i.acknowledged).length,
    overdueTasks: state.tasks.data?.overdue ?? 0,
    runwayDays: state.finance.data?.runwayDays ?? 0,
    projectBlockers: projects.reduce((sum, p) => sum + p.blockers, 0),
    vaultPending: state.vault.data?.pendingIndex ?? 0,
    failedAutomations: state.system.data?.automationFailures24h ?? 0,
  };
}

export const selectUnacknowledgedCritical = (state: DashboardState) =>
  (state.insights.data ?? []).filter((i) => i.severity === 'critical' && !i.acknowledged).length;

export const selectAnyError = (state: DashboardState) => {
  const keys: SliceKey[] = ['insights', 'fleet', 'vault', 'projects', 'system', 'finance', 'tasks'];
  return keys.some((k) => state[k].status === 'error');
};

export const selectSliceStatus = (key: SliceKey) => (state: DashboardState) => state[key].status;
