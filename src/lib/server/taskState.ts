/**
 * SAM — Daily task runtime state.
 *
 * Persists the parts of the Daily Tasks widget that the vault has no line for:
 *   - the completion log (when each task was ticked off) → drives "done today"
 *     and the day-streak;
 *   - widget-added custom tasks (ids outside the `task_priorities_` namespace).
 *
 * Done-state for vault-sourced tasks is written back into Active Priorities.md
 * itself (see taskMetrics.setTaskDone) — the vault stays the single source of
 * truth for what is queued; this file only remembers what happened and when.
 */

import fs from 'node:fs';

import type { DailyTask } from '@/types/dashboard';

const STATE_DIR = '/home/col/.sam';
const STATE_PATH = process.env.SAM_TASK_STATE_PATH ?? `${STATE_DIR}/daily-tasks-state.json`;

interface CompletionEvent {
  id: string;
  title: string;
  at: string;
}

interface TaskStateFile {
  completions: CompletionEvent[];
  customTasks: DailyTask[];
}

function load(): TaskStateFile {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    const r = (raw ?? {}) as Record<string, unknown>;
    const completions = Array.isArray(r.completions)
      ? (r.completions as CompletionEvent[]).filter(
          (c) => c && typeof c.id === 'string' && typeof c.at === 'string',
        )
      : [];
    const customTasks = Array.isArray(r.customTasks) ? (r.customTasks as DailyTask[]) : [];
    return { completions, customTasks };
  } catch {
    return { completions: [], customTasks: [] };
  }
}

const state: TaskStateFile = load();

function persist() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_PATH);
  } catch {
    // Persistence is best-effort — the in-memory estate still serves the request.
  }
}

/* --- Time helpers --------------------------------------------------------- */

/** Injectable clock so the streak math is testable without waiting days. */
let nowFn: () => Date = () => new Date();

export function __setNow(fn: () => Date) {
  nowFn = fn;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar day (server timezone) as YYYY-MM-DD. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* --- Completion log -------------------------------------------------------- */

/**
 * Record a task being ticked off. Re-completing the same task on the same day
 * replaces that day's event rather than stacking duplicates.
 */
export function recordCompletion(task: DailyTask) {
  const at = nowFn();
  const day = localDay(at);
  state.completions = state.completions.filter(
    (c) => !(c.id === task.id && localDay(new Date(c.at)) === day),
  );
  state.completions.push({ id: task.id, title: task.title, at: at.toISOString() });
  persist();
}

/** Distinct task ids with a completion on today's local day. */
export function completedTodayIds(): Set<string> {
  const day = localDay(nowFn());
  const ids = new Set<string>();
  for (const c of state.completions) {
    if (localDay(new Date(c.at)) === day) ids.add(c.id);
  }
  return ids;
}

/**
 * Current day-streak: consecutive days with at least one completion, ending
 * today if anything was completed today, otherwise ending yesterday (today is
 * still in progress).
 */
export function streakDays(): number {
  const days = new Set(state.completions.map((c) => localDay(new Date(c.at))));
  const cursor = nowFn();
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* --- Custom tasks ----------------------------------------------------------- */

export function getCustomTasks(): DailyTask[] {
  return [...state.customTasks];
}

/** Insert or update a widget-added task in the persisted store. */
export function upsertCustomTask(task: DailyTask) {
  const idx = state.customTasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) state.customTasks[idx] = { ...task };
  else state.customTasks.push(task);
  persist();
}

export function deleteCustomTask(id: string) {
  state.customTasks = state.customTasks.filter((t) => t.id !== id);
  persist();
}
