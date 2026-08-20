'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, CheckSquare, Flame, Plus, Trash2 } from 'lucide-react';

import type { DailyTask, TaskPriority } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { emptyState, taskNudge } from '@/lib/personalityEngine';
import { useDashboardStore } from '@/store/dashboardStore';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import {
  EmptyState,
  Pill,
  RelativeTime,
  Stat,
  TONE_COLOR,
  type ToneName,
} from '@/components/ui/Indicators';
import { useLiveClock } from '@/hooks/useLiveClock';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const PRIORITY_TONE: Record<TaskPriority, ToneName> = {
  p0: 'critical',
  p1: 'warning',
  p2: 'accent-2',
  p3: 'muted',
};

const PRIORITY_CYCLE: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];

function TaskRow({ task, index, showMeta }: { task: DailyTask; index: number; showMeta: boolean }) {
  const toggleTask = useDashboardStore((s) => s.toggleTask);
  const deleteTask = useDashboardStore((s) => s.deleteTask);
  const now = useLiveClock(30_000);

  const overdue =
    !task.done && task.dueAt !== null && now !== null && Date.parse(task.dueAt) < now;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.03, 0.2) }}
      className="group/task flex items-center gap-2.5 bg-void-900/40 px-3 py-2 transition-colors hover:bg-white/[0.028]"
    >
      <button
        type="button"
        onClick={() => toggleTask(task.id)}
        role="checkbox"
        aria-checked={task.done}
        aria-label={`${task.done ? 'Reopen' : 'Complete'}: ${task.title}`}
        className={cn(
          'flex size-[15px] shrink-0 items-center justify-center rounded-[3px] border transition-all',
          task.done
            ? 'border-toxic-400 bg-toxic-400/85 text-void-950'
            : 'border-void-300 hover:border-[var(--sam-accent-2)] hover:bg-[var(--sam-accent-2)]/12',
        )}
      >
        <AnimatePresence>
          {task.done && (
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Check size={10} strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-[12px] leading-snug transition-colors',
            task.done ? 'text-slate-600 line-through' : 'text-slate-200',
          )}
          title={task.title}
        >
          {task.title}
        </p>

        {showMeta && (
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] tracking-wider text-slate-600 uppercase">
            <span>{task.tag}</span>
            {task.origin !== 'operator' && (
              <>
                <span className="text-dim-200">·</span>
                <span className={task.origin === 'sam' ? 'text-[var(--sam-accent)]' : undefined}>
                  queued by {task.origin}
                </span>
              </>
            )}
            {task.dueAt && (
              <>
                <span className="text-dim-200">·</span>
                <RelativeTime
                  value={task.dueAt}
                  prefix="due "
                  className={overdue ? 'text-alarm-300' : undefined}
                />
              </>
            )}
          </div>
        )}
      </div>

      {overdue && <Flame size={11} className="shrink-0 text-alarm-400" aria-label="Overdue" />}

      <span
        className="shrink-0 font-mono text-[9px] tracking-wider uppercase"
        style={{ color: TONE_COLOR[PRIORITY_TONE[task.priority]] }}
      >
        {task.priority}
      </span>

      {!task.id.startsWith('task_priorities_') && (
        <button
          type="button"
          onClick={() => deleteTask(task.id)}
          aria-label={`Delete: ${task.title}`}
          className="shrink-0 rounded-[3px] p-1 text-dim-200 opacity-0 transition hover:bg-alarm-500/15 hover:text-alarm-300 focus-visible:opacity-100 group-hover/task:opacity-100"
        >
          <Trash2 size={11} />
        </button>
      )}
    </motion.div>
  );
}

export function DailyTasksWidget({ size, index, dragHandleProps, isDragging, isOverlay }: WidgetProps) {
  const slice = useDashboardStore((s) => s.tasks);
  const refresh = useDashboardStore((s) => s.refresh);
  const addTask = useDashboardStore((s) => s.addTask);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);

  const [draft, setDraft] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('p2');
  const [hideDone, setHideDone] = useState(false);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const payload = slice.data;

  const tasks = useMemo(() => {
    const list = payload?.tasks ?? [];
    return hideDone ? list.filter((t) => !t.done) : list;
  }, [payload, hideDone]);

  const openCount = useMemo(
    () => (payload?.tasks ?? []).filter((t) => !t.done).length,
    [payload],
  );

  const nudge = payload ? taskNudge(payload.overdue, 'tasks-widget', sarcasm) : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    void addTask(draft, priority);
    setDraft('');
  };

  const visible = tasks.slice(0, profile.rows + (profile.large ? 3 : 0));

  return (
    <WidgetFrame
      id="daily-tasks"
      title="Daily Tasks"
      subtitle={profile.compact ? undefined : `${openCount} open`}
      icon={<CheckSquare size={13} />}
      tone="accent"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="list"
      onRefresh={() => refresh('tasks')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        // A 1-column header cannot carry the pill, the filter and the menu
        // without eating the title. The overdue count still shows in the footer.
        <>
          {payload && payload.overdue > 0 && (profile.wide || profile.large) && (
            <Pill tone="critical">{payload.overdue} overdue</Pill>
          )}
          {!profile.compact && (
            <button
              type="button"
              onClick={() => setHideDone((v) => !v)}
              className={cn(
                'rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase transition-colors',
                hideDone
                  ? 'bg-[var(--sam-accent)]/18 text-[var(--sam-accent)]'
                  : 'text-slate-600 hover:text-slate-400',
              )}
            >
              Open
            </button>
          )}
        </>
      }
      footer={
        !profile.compact &&
        payload && (
          <span className="truncate text-[10.5px] text-slate-500 italic">
            {nudge ?? `${payload.completedToday} done today · ${payload.streakDays}-day streak`}
          </span>
        )
      }
    >
      {profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-4xl leading-none font-semibold text-[var(--sam-accent)]">
              {openCount}
            </span>
            <span className="label">open</span>
          </div>

          {visible[0] ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
              {visible[0].title}
            </p>
          ) : (
            <p className="text-[11px] text-slate-600 italic">{emptyState('tasks', 'sm', sarcasm)}</p>
          )}

          <div className="flex gap-1.5">
            {payload && payload.overdue > 0 ? (
              <Pill tone="critical">{payload.overdue} overdue</Pill>
            ) : (
              <Pill tone="success">clear</Pill>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* Quick add */}
          <form
            onSubmit={handleSubmit}
            className="flex shrink-0 items-center gap-2 border-b border-void-500/35 px-3 py-2"
          >
            <Plus size={12} className="shrink-0 text-dim-200" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a task…"
              aria-label="New task title"
              maxLength={200}
              className="min-w-0 flex-1 bg-transparent text-[11.5px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                setPriority(
                  PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(priority) + 1) % PRIORITY_CYCLE.length],
                )
              }
              title="Cycle priority"
              aria-label={`Priority ${priority}, click to change`}
              className="shrink-0 rounded-[3px] border px-1.5 py-[3px] font-mono text-[9px] tracking-wider uppercase transition-colors"
              style={{
                color: TONE_COLOR[PRIORITY_TONE[priority]],
                borderColor: `color-mix(in oklab, ${TONE_COLOR[PRIORITY_TONE[priority]]} 40%, transparent)`,
              }}
            >
              {priority}
            </button>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="shrink-0 rounded-[3px] border border-[var(--sam-accent)]/35 bg-[var(--sam-accent)]/12 px-2 py-[3px] font-mono text-[9.5px] tracking-wider text-[var(--sam-accent)] uppercase transition-colors hover:bg-[var(--sam-accent)]/22 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Add
            </button>
          </form>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <EmptyState message={emptyState('tasks', 'list', sarcasm)} icon={<CheckSquare size={20} />} />
            ) : (
              <div className="divide-y divide-void-500/25">
                {/* AnimatePresence must directly parent the animated children. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  {visible.map((task, i) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      index={i}
                      showMeta={profile.tall || profile.large}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {profile.large && payload && (
            <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-void-500/35 px-3 py-2">
              <Stat label="open" value={openCount} tone="accent" />
              <Stat label="done today" value={payload.completedToday} tone="success" />
              <Stat label="streak" value={`${payload.streakDays}d`} align="right" />
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
