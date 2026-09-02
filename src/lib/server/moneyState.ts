/**
 * SAM — Money In store.
 *
 * The single real source for the Money In widget: income Colin logs by hand
 * as it lands (Atwood client payments, day-job salary, whatever). Persisted to
 * `~/.sam/money-state.json` — the same append-only JSON pattern as
 * `taskState.ts` — so entries survive restarts and never come from a
 * simulator. Empty until the first entry is logged.
 *
 * Amounts are whole pounds. Dates are local calendar days (YYYY-MM-DD), so
 * "this month" follows Colin's clock, not UTC.
 */

import fs from 'node:fs';

import type { MoneyEntry, MoneyInPayload } from '@/types/dashboard';

const STATE_DIR = '/home/col/.sam';
const STATE_PATH = process.env.SAM_MONEY_STATE_PATH ?? `${STATE_DIR}/money-state.json`;

interface MoneyStateFile {
  entries: MoneyEntry[];
}

function isEntry(raw: unknown): raw is MoneyEntry {
  if (typeof raw !== 'object' || raw === null) return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.label === 'string' &&
    typeof e.amount === 'number' &&
    Number.isFinite(e.amount) &&
    e.amount > 0 &&
    typeof e.date === 'string' &&
    typeof e.source === 'string' &&
    typeof e.createdAt === 'string' &&
    (e.recurring === undefined || typeof e.recurring === 'boolean')
  );
}

function load(): MoneyStateFile {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    const r = (raw ?? {}) as Record<string, unknown>;
    // `recurring` is new — pre-existing entries lack it and are one-off.
    const entries = Array.isArray(r.entries)
      ? (r.entries as unknown[]).filter(isEntry).map((e) => ({ ...e, recurring: e.recurring === true }))
      : [];
    return { entries };
  } catch {
    return { entries: [] };
  }
}

const state: MoneyStateFile = load();

function persist() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_PATH);
  } catch {
    // Persistence is best-effort — the in-memory store still serves the request.
  }
}

/* --- Time helpers --------------------------------------------------------- */

/** Injectable clock so the month math is testable without waiting days. */
let nowFn: () => Date = () => new Date();

export function __setNow(fn: () => Date) {
  nowFn = fn;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar day as YYYY-MM-DD. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM` prefix of a stored date string. */
function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Validates a stored date string is a real YYYY-MM-DD that parses. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00`);
  return !Number.isNaN(d.getTime()) && localDay(d) === date;
}

/* --- Entries --------------------------------------------------------------- */

export function getEntries(): MoneyEntry[] {
  return [...state.entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface NewMoneyEntry {
  label: string;
  amount: number;
  date: string;
  source: string;
  /** Monthly recurring income counts every month from `date` onward. */
  recurring: boolean;
}

/** Insert a logged income entry and persist. Returns the stored entry. */
export function addEntry(input: NewMoneyEntry): MoneyEntry {
  const entry: MoneyEntry = {
    id: `money_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: input.label,
    amount: input.amount,
    date: input.date,
    source: input.source,
    recurring: input.recurring === true,
    createdAt: nowFn().toISOString(),
  };
  state.entries.push(entry);
  persist();
  return entry;
}

/** Remove an entry by id. Returns false if it didn't exist. */
export function deleteEntry(id: string): boolean {
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => e.id !== id);
  const removed = state.entries.length !== before;
  if (removed) persist();
  return removed;
}

/* --- Summary ---------------------------------------------------------------- */

/** True when an entry contributes to the given `YYYY-MM` month. A recurring
 *  entry starts at `date`'s month and recurs every month after. */
function activeInMonth(e: MoneyEntry, key: string): boolean {
  const start = monthKey(e.date);
  return e.recurring ? start <= key : start === key;
}

export function getSummary(): MoneyInPayload {
  const now = nowFn();
  const thisMonth = monthKey(localDay(now));

  // Previous calendar month, honouring the year boundary.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = monthKey(localDay(prev));

  const entries = getEntries();

  let totalThisMonth = 0;
  let countThisMonth = 0;
  let totalLastMonth = 0;

  for (const e of entries) {
    // Independent checks: a recurring entry can count toward both months.
    if (activeInMonth(e, thisMonth)) {
      totalThisMonth += e.amount;
      countThisMonth++;
    }
    if (activeInMonth(e, lastMonth)) {
      totalLastMonth += e.amount;
    }
  }

  const monthDeltaPct =
    totalLastMonth > 0 ? Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 1000) / 10 : -1;

  return {
    currency: 'GBP',
    entries,
    totalThisMonth,
    countThisMonth,
    totalLastMonth,
    monthDeltaPct,
  };
}
