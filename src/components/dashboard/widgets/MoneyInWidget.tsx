'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, Plus, Repeat, Trash2 } from 'lucide-react';

import type { MoneyEntry } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/store/dashboardStore';
import { WidgetFrame } from '@/components/dashboard/WidgetFrame';
import type { WidgetProps } from '@/components/dashboard/widgetRegistry';
import {
  Delta,
  EmptyState,
  Pill,
  Stat,
  TONE_COLOR,
} from '@/components/ui/Indicators';
import { resolveStatus, sizeProfile } from '@/components/dashboard/widgets/shared';

const SUCCESS = TONE_COLOR.success;

/** Whole pounds, British grouping: 1200 → "1,200". */
function pounds(amount: number): string {
  return `£${Math.round(amount).toLocaleString('en-GB')}`;
}

/** Local calendar day as YYYY-MM-DD — the same clock the server uses. */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Stored date → a compact, human "19 Aug" style read. */
function formatDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function EntryRow({ entry, index, showSource }: { entry: MoneyEntry; index: number; showSource: boolean }) {
  const deleteMoneyEntry = useDashboardStore((s) => s.deleteMoneyEntry);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.24, delay: Math.min(index * 0.03, 0.2) }}
      className="group/money flex items-center gap-2.5 bg-void-900/40 px-3 py-2 transition-colors hover:bg-white/[0.028]"
    >
      <span
        className="flex size-[15px] shrink-0 items-center justify-center rounded-[3px] border border-[var(--sam-accent)]/30"
        style={{ color: SUCCESS }}
      >
        <Banknote size={9} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-snug text-slate-200" title={entry.label}>
          {entry.label}
        </p>
        {(showSource || entry.source || entry.recurring) && (
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] tracking-wider text-slate-600 uppercase">
            <span>{formatDate(entry.date)}</span>
            {entry.recurring && (
              <>
                <span className="text-dim-200">·</span>
                <span className="flex items-center gap-1 text-[var(--sam-accent-2)]">
                  <Repeat size={8} /> monthly
                </span>
              </>
            )}
            {entry.source && (
              <>
                <span className="text-dim-200">·</span>
                <span className="truncate text-[var(--sam-accent-2)]">{entry.source}</span>
              </>
            )}
          </div>
        )}
      </div>

      <span className="tabular shrink-0 font-semibold text-slate-100" style={{ color: SUCCESS }}>
        {pounds(entry.amount)}
      </span>

      <button
        type="button"
        onClick={() => deleteMoneyEntry(entry.id)}
        aria-label={`Delete: ${entry.label}`}
        className="shrink-0 rounded-[3px] p-1 text-dim-200 opacity-0 transition hover:bg-alarm-500/15 hover:text-alarm-300 focus-visible:opacity-100 group-hover/money:opacity-100"
      >
        <Trash2 size={11} />
      </button>
    </motion.div>
  );
}

export function MoneyInWidget({ size, index, dragHandleProps, isDragging, isOverlay }: WidgetProps) {
  const slice = useDashboardStore((s) => s.money);
  const refresh = useDashboardStore((s) => s.refresh);
  const addMoneyEntry = useDashboardStore((s) => s.addMoneyEntry);

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayLocal);
  const [source, setSource] = useState('');
  const [recurring, setRecurring] = useState(false);

  const profile = sizeProfile(size);
  const status = resolveStatus(slice);
  const payload = slice.data;

  const entries = useMemo(() => payload?.entries ?? [], [payload]);
  const visible = entries.slice(0, profile.rows + (profile.large ? 3 : 0));

  const parsedAmount = Number.parseInt(amount, 10);
  const canAdd = label.trim().length > 0 && Number.isInteger(parsedAmount) && parsedAmount > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    void addMoneyEntry({
      label: label.trim(),
      amount: parsedAmount,
      date: date || todayLocal(),
      source: source.trim() || undefined,
      recurring,
    });
    setAmount('');
    setLabel('');
    setSource('');
    setDate(todayLocal());
    setRecurring(false);
  };

  const hasPrevMonth = payload !== null && payload.monthDeltaPct >= 0 && payload.totalLastMonth > 0;

  return (
    <WidgetFrame
      id="money-in"
      title="Money In"
      subtitle={profile.compact ? undefined : `${payload?.countThisMonth ?? 0} logged`}
      icon={<Banknote size={13} />}
      tone="success"
      size={size}
      status={status}
      error={slice.error}
      updatedAt={slice.updatedAt}
      index={index}
      skeletonVariant="list"
      onRefresh={() => refresh('money')}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      isOverlay={isOverlay}
      headerRight={
        payload && payload.countThisMonth > 0 && (profile.wide || profile.large) ? (
          <Pill tone="success">{payload.countThisMonth} in</Pill>
        ) : undefined
      }
      footer={
        !profile.compact &&
        payload && (
          <span className="truncate text-[10.5px] text-slate-500 italic">
            {hasPrevMonth
              ? `vs ${pounds(payload.totalLastMonth)} last month`
              : payload.entries.length === 0
                ? 'Log the first payment and it lands here.'
                : 'First logged month — no baseline yet.'}
          </span>
        )
      }
    >
      {profile.compact ? (
        <div className="flex h-full flex-col justify-between p-3">
          <div className="flex items-baseline gap-2">
            <span className="tabular text-3xl leading-none font-bold" style={{ color: SUCCESS }}>
              {payload ? pounds(payload.totalThisMonth) : '£0'}
            </span>
            <span className="label">this month</span>
          </div>

          {entries[0] ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
              {entries[0].label} · {pounds(entries[0].amount)}
            </p>
          ) : (
            <p className="text-[11px] text-slate-600 italic">Nothing logged yet.</p>
          )}

          <div className="flex gap-1.5">
            {payload && payload.countThisMonth > 0 ? (
              <Pill tone="success">{payload.countThisMonth} this month</Pill>
            ) : (
              <Pill tone="muted">no money in yet</Pill>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* Headline — this month, bold */}
          <div className="flex shrink-0 items-baseline justify-between px-3 pt-2.5 pb-1">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-3xl leading-none font-bold" style={{ color: SUCCESS }}>
                {payload ? pounds(payload.totalThisMonth) : '£0'}
              </span>
              <span className="label">this month</span>
            </div>
            {payload && hasPrevMonth && <Delta value={payload.monthDeltaPct} />}
          </div>

          {/* Quick add */}
          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-b border-void-500/35 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <div className="flex shrink-0 items-center gap-1 rounded-[3px] border border-void-500/50 bg-void-900/60 px-2 focus-within:border-[var(--sam-accent)]/50">
                <span className="font-mono text-[10px] text-slate-500">£</span>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))}
                  placeholder="1200"
                  aria-label="Amount in pounds"
                  inputMode="numeric"
                  className="w-[4.5ch] bg-transparent py-1 text-[11.5px] text-slate-100 tabular placeholder:text-slate-600 focus:outline-none"
                />
              </div>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="What landed, e.g. 4edge deposit"
                aria-label="Income label"
                maxLength={120}
                className="min-w-0 flex-1 bg-transparent text-[11.5px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setRecurring((r) => !r)}
                aria-pressed={recurring}
                title={
                  recurring
                    ? 'Counts every month from the start date onward'
                    : 'Mark as monthly recurring income'
                }
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-[3px] border px-1.5 py-[3px] font-mono text-[9.5px] tracking-wider uppercase transition-colors',
                  recurring
                    ? 'border-[var(--sam-accent)]/50 bg-[var(--sam-accent)]/18 text-[var(--sam-accent)]'
                    : 'border-void-500/50 text-slate-600 hover:border-void-500/70 hover:text-slate-400',
                )}
              >
                <Repeat size={9} />
                {recurring ? 'Monthly' : 'One-off'}
              </button>
              <button
                type="submit"
                disabled={!canAdd}
                className="shrink-0 rounded-[3px] border border-[var(--sam-accent)]/35 bg-[var(--sam-accent)]/12 px-2 py-[3px] font-mono text-[9.5px] tracking-wider text-[var(--sam-accent)] uppercase transition-colors hover:bg-[var(--sam-accent)]/22 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Add
              </button>
            </div>
            {profile.wide || profile.large ? (
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  type="date"
                  aria-label={recurring ? 'First payment date' : 'Date received'}
                  className="rounded-[3px] border border-void-500/50 bg-void-900/60 px-1.5 py-[3px] font-mono text-[9.5px] tracking-wider text-slate-400 focus:border-[var(--sam-accent)]/50 focus:outline-none"
                />
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="Source (optional) — Atwood, day job, trading…"
                  aria-label="Income source"
                  maxLength={60}
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-400 placeholder:text-slate-600 focus:outline-none"
                />
              </div>
            ) : null}
          </form>

          {/* List */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <EmptyState
                message="No money logged yet. When a payment lands, drop it in the form above — real money only, no estimates."
                icon={<Banknote size={20} />}
              />
            ) : (
              <div className="divide-y divide-void-500/25">
                <AnimatePresence mode="popLayout" initial={false}>
                  {visible.map((entry, i) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      index={i}
                      showSource={profile.tall || profile.large}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {profile.large && payload && (
            <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-void-500/35 px-3 py-2">
              <Stat label="this month" value={pounds(payload.totalThisMonth)} tone="success" />
              <Stat label="last month" value={pounds(payload.totalLastMonth)} tone="muted" />
              <Stat
                label="vs last month"
                value={
                  hasPrevMonth ? (
                    <Delta value={payload.monthDeltaPct} />
                  ) : (
                    <span className="text-[11px] text-slate-600 italic">n/a</span>
                  )
                }
                align="right"
              />
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
