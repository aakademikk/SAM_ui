/**
 * SAM — Scheduled-jobs data reader.
 *
 * Reads `systemctl --user list-timers --all` and `crontab -l`, read-only,
 * and builds the one list the clock ring and Schedule panel (T17/T18) draw
 * from. Every real command runs through an injectable seam (`run`) so tests
 * never touch Colin's real timers or crontab (see `schedule.test.ts`).
 *
 * Verified against this box's real (read-only) `systemctl --user show`
 * output 2026-10-02, never against Colin's real unit names or crontab
 * content (this repo is public — see the ticket's "Do not touch"):
 *
 * - The calendar expression lives on the TIMER unit as `TimersCalendar=`
 *   (e.g. `{ OnCalendar=*-*-* 06:00:00 ; next_elapse=... }`); a monotonic
 *   timer carries `TimersMonotonic=` instead (e.g.
 *   `{ OnUnitActiveUSec=5min ; next_elapse=... }`). A unit can report either
 *   property more than once (one line per directive) — `showUnits` below
 *   keeps every value, not just the last.
 * - `Result`, `ExecMainStatus`, `ActiveState` and `ExecStart` live on the
 *   SERVICE unit the timer activates (`list-timers`' ACTIVATES column), not
 *   on the timer itself.
 * - `systemctl --user show <unit1> <unit2> ... -p <props>` batches cleanly:
 *   one process, one block per unit separated by a blank line, each block
 *   carrying its own `Id=` — so a single call covers every timer (or every
 *   service) this reader needs, keeping the per-poll process count fixed at
 *   four (list-timers, one show for timers, one show for services,
 *   crontab) regardless of how many timers exist.
 * - `systemctl --user list-timers --all --output=json` works on this box
 *   (systemd 259) and is preferred: `next`/`last` arrive as microseconds
 *   since the epoch, with `0` meaning "never" — exactly the `-`/n/a case
 *   the ticket calls out. A JSON parse failure (older systemd) falls back
 *   to a best-effort column parse that recovers the unit/service pairing
 *   but not precise last/next times (see `parseListTimersColumns`) — an
 *   honest `null` beats a mis-parsed timestamp.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { ScheduleCadence, ScheduleLastResult, ScheduledJob } from '@/types/floor';

export type CommandRunner = (cmd: string, args: string[]) => Promise<string>;

/** Real `child_process.execFile`, wrapped as the injectable seam's default. */
export async function defaultCommandRunner(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error(error.message) as Error & { stdout?: string; stderr?: string };
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
        return;
      }
      resolve(stdout);
    });
  });
}

/** Reads the real (or stubbed) `systemctl --user list-timers` and `crontab -l`, builds the whole list. */
export async function readScheduledJobs(run: CommandRunner = defaultCommandRunner): Promise<ScheduledJob[]> {
  const [timers, cron] = await Promise.all([readTimers(run), readCron(run)]);
  return [...timers, ...cron];
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

interface ListTimerEntry {
  unit?: string;
  activates?: string;
  /** Microseconds since the epoch; 0 means "never" (n/a). */
  last?: number;
  /** Microseconds since the epoch; 0 means "never scheduled" (n/a). */
  next?: number;
}

async function readTimers(run: CommandRunner): Promise<ScheduledJob[]> {
  let listRaw: string;
  try {
    listRaw = await run('systemctl', ['--user', 'list-timers', '--all', '--output=json']);
  } catch {
    // systemctl unavailable, no user instance, or (in a stub) deliberately
    // failing — read-only, so this is an empty list, not a thrown error.
    return [];
  }

  const entries = parseListTimersOutput(listRaw).filter(
    (e): e is ListTimerEntry & { unit: string } => typeof e.unit === 'string' && e.unit.length > 0,
  );
  if (entries.length === 0) return [];

  const timerUnits = entries.map((e) => e.unit);
  const serviceUnits = entries
    .map((e) => e.activates)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);

  const [timerProps, serviceProps] = await Promise.all([
    showUnits(run, timerUnits, ['Id', 'TimersCalendar', 'TimersMonotonic']),
    showUnits(run, serviceUnits, ['Id', 'Result', 'ExecMainStatus', 'ActiveState', 'ExecStart']),
  ]);

  return entries.map((entry) =>
    buildTimerJob(entry, timerProps.get(entry.unit), entry.activates ? serviceProps.get(entry.activates) : undefined),
  );
}

function parseListTimersOutput(raw: string): ListTimerEntry[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({
          unit: typeof e.unit === 'string' ? e.unit : undefined,
          activates: typeof e.activates === 'string' ? e.activates : undefined,
          last: typeof e.last === 'number' ? e.last : 0,
          next: typeof e.next === 'number' ? e.next : 0,
        }));
    }
  } catch {
    // Not JSON — this systemd predates --output=json support. Fall through.
  }

  return parseListTimersColumns(trimmed);
}

/**
 * Best-effort fallback for a systemd whose `list-timers` has no JSON output.
 * Recovers the UNIT/ACTIVATES pairing (so the schedule and result can still
 * be read via `show`) but not a trustworthy NEXT/LAST timestamp — the
 * column text ("Fri 2026-10-02 14:00:00 BST") carries a timezone
 * abbreviation `Date.parse` cannot be trusted to round-trip, so those two
 * fields are left `0` (i.e. null) rather than risk a wrong time.
 */
function parseListTimersColumns(text: string): ListTimerEntry[] {
  const lines = text.split('\n').map((line) => line.trimEnd());
  const headerIdx = lines.findIndex(
    (line) => /\bNEXT\b/.test(line) && /\bUNIT\b/.test(line) && /\bACTIVATES\b/.test(line),
  );
  if (headerIdx < 0) return [];

  const entries: ListTimerEntry[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/timers? listed/i.test(line) || /^Pass /.test(line.trim())) break;

    const cols = line
      .split(/\s{2,}/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cols.length < 2) continue;

    const unit = cols[cols.length - 2];
    const activates = cols[cols.length - 1];
    if (!unit.endsWith('.timer')) continue;

    entries.push({ unit, activates, last: 0, next: 0 });
  }
  return entries;
}

/** Batches `systemctl --user show` across every unit in one process (bounded, cheap per poll). */
async function showUnits(
  run: CommandRunner,
  units: string[],
  props: string[],
): Promise<Map<string, Map<string, string[]>>> {
  const uniqueUnits = [...new Set(units)];
  if (uniqueUnits.length === 0) return new Map();

  let out: string;
  try {
    out = await run('systemctl', ['--user', 'show', ...uniqueUnits, '-p', props.join(',')]);
  } catch {
    return new Map();
  }
  return parseShowBlocks(out);
}

/** `systemctl show`'s multi-unit output: blocks separated by a blank line, each carrying its own `Id=`. */
function parseShowBlocks(output: string): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();
  const blocks = output.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const props = new Map<string, string[]>();
    let id: string | null = null;
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      if (key === 'Id') id = value;
      const existing = props.get(key);
      if (existing) existing.push(value);
      else props.set(key, [value]);
    }
    if (id) result.set(id, props);
  }
  return result;
}

function buildTimerJob(
  entry: ListTimerEntry & { unit: string },
  timerProps: Map<string, string[]> | undefined,
  serviceProps: Map<string, string[]> | undefined,
): ScheduledJob {
  const unit = entry.unit;
  const name = unit.replace(/\.timer$/, '');
  const schedule = scheduleFromTimerProps(timerProps);
  const lastRun = microsToIso(entry.last);
  const nextRun = microsToIso(entry.next);
  const execStart = serviceProps?.get('ExecStart')?.[0] ?? '';

  return {
    id: unit,
    kind: 'timer',
    name,
    schedulePlain: schedule.plain,
    cadence: schedule.cadence,
    lastRun,
    lastResult: timerLastResult(lastRun, serviceProps),
    nextRun,
    launchesFleetJob: execStart.includes('sam-dispatch'),
  };
}

function microsToIso(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value / 1000).toISOString();
}

/**
 * 'running' when the service is mid-run; 'failed' when its last `Result`
 * wasn't success or its exit status was non-zero (Must 25: stays 'failed'
 * until a later successful run overwrites both properties); 'not recorded'
 * when the timer has never fired, so there is no result to report honestly;
 * else 'ok'.
 */
function timerLastResult(
  lastRunIso: string | null,
  serviceProps: Map<string, string[]> | undefined,
): ScheduleLastResult {
  if (!lastRunIso) return 'not recorded';

  const activeState = serviceProps?.get('ActiveState')?.[0];
  if (activeState === 'active' || activeState === 'activating') return 'running';

  const result = serviceProps?.get('Result')?.[0];
  const execMainStatusRaw = serviceProps?.get('ExecMainStatus')?.[0];
  const execMainStatus = execMainStatusRaw != null ? Number(execMainStatusRaw) : null;

  const resultFailed = typeof result === 'string' && result.length > 0 && result !== 'success';
  const statusFailed = execMainStatus != null && Number.isFinite(execMainStatus) && execMainStatus !== 0;
  if (resultFailed || statusFailed) return 'failed';

  return 'ok';
}

// ---------------------------------------------------------------------------
// Schedule classification (shared shape between timer calendar/monotonic
// expressions and cron's 5-field syntax)
// ---------------------------------------------------------------------------

interface Schedule {
  plain: string;
  cadence: ScheduleCadence;
}

function pad2(n: number | string): string {
  return String(n).padStart(2, '0');
}

const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // index 0 = Mon .. 6 = Sun
const DOW_FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function describeDaySet(days: ReadonlySet<number>): string {
  // `days` holds ISO weekday numbers, 1 (Mon) .. 7 (Sun).
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 1) return `${DOW_FULL_NAMES[sorted[0] - 1]}s`;
  return sorted.map((d) => DOW_NAMES[d - 1]).join('/');
}

function scheduleFromTimerProps(timerProps: Map<string, string[]> | undefined): Schedule {
  const calendars = timerProps?.get('TimersCalendar') ?? [];
  const monotonics = timerProps?.get('TimersMonotonic') ?? [];

  for (const raw of calendars) {
    const expr = extractBraced(raw, 'OnCalendar');
    if (expr) {
      const parsed = classifyCalendarExpr(expr);
      if (parsed) return parsed;
    }
  }

  const recurringKeys = ['OnUnitActiveUSec', 'OnActiveUSec', 'OnUnitInactiveUSec'];
  for (const raw of monotonics) {
    const kv = extractAnyBracedKeyValue(raw);
    if (kv && recurringKeys.includes(kv.key)) {
      const minutes = parseDurationMinutes(kv.value);
      if (minutes != null) return describeIntervalMinutes(minutes);
    }
  }

  const fallback = calendars[0] ?? monotonics[0];
  return { plain: fallback ? stripBraces(fallback) : 'Unknown schedule', cadence: 'other' };
}

function stripBraces(raw: string): string {
  return raw.replace(/^\{\s*/, '').replace(/\s*\}$/, '').trim();
}

function extractBraced(raw: string, key: string): string | null {
  const m = raw.match(new RegExp(`${key}=(.*?)\\s*;`));
  return m ? m[1].trim() : null;
}

function extractAnyBracedKeyValue(raw: string): { key: string; value: string } | null {
  const m = raw.match(/^\{?\s*([A-Za-z]+)=(.*?)\s*;/);
  return m ? { key: m[1], value: m[2].trim() } : null;
}

function describeIntervalMinutes(minutes: number): Schedule {
  if (minutes <= 60) {
    return { plain: minutes === 60 ? 'Hourly' : `Every ${Math.round(minutes)} min`, cadence: 'frequent' };
  }
  if (minutes < 24 * 60) {
    const hours = minutes / 60;
    const label = Number.isInteger(hours) ? `Every ${hours} hours` : `Every ${Math.round(minutes)} min`;
    return { plain: label, cadence: 'hours' };
  }
  if (Math.abs(minutes - 24 * 60) <= 2) return { plain: 'Daily', cadence: 'daily' };
  if (Math.abs(minutes - 7 * 24 * 60) <= 60) return { plain: 'Weekly', cadence: 'weekly' };
  return { plain: `Every ${Math.round(minutes / (24 * 60))} days`, cadence: 'other' };
}

/** `5min`, `30s`, `1h30min`, `2w 5h 53min` — systemd's own duration text. */
function parseDurationMinutes(value: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*(w|weeks?|d|days?|h|hours?|hr|min|minutes?|s|seconds?|ms)\b/gi;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    matched = true;
    const amount = Number(m[1]);
    const unitRaw = m[2].toLowerCase();
    const msPerUnit = unitRaw.startsWith('w')
      ? 7 * 24 * 60 * 60_000
      : unitRaw.startsWith('d')
        ? 24 * 60 * 60_000
        : unitRaw.startsWith('h')
          ? 60 * 60_000
          : unitRaw.startsWith('min')
            ? 60_000
            : unitRaw.startsWith('ms')
              ? 1
              : unitRaw.startsWith('s')
                ? 1_000
                : null;
    if (msPerUnit == null) continue;
    total += amount * msPerUnit;
  }
  return matched ? total / 60_000 : null;
}

const WEEKDAY_TOKEN_RE = /mon|tue|wed|thu|fri|sat|sun/i;

function parseCalendarWeekdayList(tok: string): Set<number> | null {
  const names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const days = new Set<number>();
  for (const part of tok.split(',')) {
    if (part.includes('..')) {
      const [a, b] = part.split('..');
      const ai = names.indexOf(a.toLowerCase().slice(0, 3));
      const bi = names.indexOf(b.toLowerCase().slice(0, 3));
      if (ai < 0 || bi < 0) return null;
      for (let i = ai; i <= bi; i++) days.add(i + 1); // 1-based, Mon=1..Sun=7
    } else {
      const i = names.indexOf(part.toLowerCase().slice(0, 3));
      if (i < 0) return null;
      days.add(i + 1);
    }
  }
  return days;
}

/**
 * Classifies a systemd `OnCalendar=` expression (e.g. `*-*-* 06:00:00`,
 * `Mon *-*-* 08:00:00`, `*-*-* *:02/5:00`). Returns null only when the
 * expression can't even be tokenised; an unclassifiable but tokenisable
 * expression still returns `{ cadence: 'other' }` with the raw text as its
 * plain words (never invents a schedule it can't read).
 */
function classifyCalendarExpr(expr: string): Schedule | null {
  const tokens = expr.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let weekdayTok: string | null = null;
  let rest = tokens;
  if (tokens.length >= 2 && WEEKDAY_TOKEN_RE.test(tokens[0])) {
    weekdayTok = tokens[0];
    rest = tokens.slice(1);
  }
  if (rest.length === 0) return null;

  let dateTok: string | null = null;
  let timeTok: string;
  if (rest.length >= 2) {
    [dateTok, timeTok] = rest;
  } else {
    timeTok = rest[0];
  }

  if (dateTok && dateTok !== '*-*-*') return { plain: expr, cadence: 'other' };

  const timeParts = timeTok.split(':');
  if (timeParts.length < 2) return { plain: expr, cadence: 'other' };
  const [hh, mm] = timeParts;

  if (weekdayTok) {
    const days = parseCalendarWeekdayList(weekdayTok);
    if (!days) return { plain: expr, cadence: 'other' };
    const timeLabel = /^\d+$/.test(hh) ? `${pad2(hh)}:${pad2(mm.split('/')[0] ?? mm)}` : null;
    const isWeekdayOnly = days.size === 5 && [1, 2, 3, 4, 5].every((d) => days.has(d));
    if (isWeekdayOnly) {
      return { plain: timeLabel ? `Weekdays at ${timeLabel}` : expr, cadence: 'weekday' };
    }
    return { plain: timeLabel ? `${describeDaySet(days)} at ${timeLabel}` : expr, cadence: 'weekly' };
  }

  // Every day (no weekday restriction).
  if (hh === '*') {
    if (mm === '*') return { plain: 'Every minute', cadence: 'frequent' };
    const stepMatch = mm.match(/^\d+\/(\d+)$/);
    if (stepMatch) return { plain: `Every ${Number(stepMatch[1])} min`, cadence: 'frequent' };
    if (/^\d+$/.test(mm)) return { plain: 'Hourly', cadence: 'frequent' };
    return { plain: expr, cadence: 'other' };
  }
  const hourStep = hh.match(/^\d+\/(\d+)$/);
  if (hourStep) {
    const step = Number(hourStep[1]);
    if (step >= 2 && step < 24) return { plain: `Every ${step} hours`, cadence: 'hours' };
    return { plain: expr, cadence: 'other' };
  }
  if (/^\d+$/.test(hh)) {
    return { plain: `Daily at ${pad2(hh)}:${pad2(mm.split('/')[0] ?? mm)}`, cadence: 'daily' };
  }
  return { plain: expr, cadence: 'other' };
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

async function readCron(run: CommandRunner): Promise<ScheduledJob[]> {
  let raw: string;
  try {
    raw = await run('crontab', ['-l']);
  } catch {
    // Covers "no crontab for <user>" (exit 1) and any other crontab
    // failure alike — read-only, fail-open: an empty list, not an error
    // (the ticket's explicit instruction for the no-crontab case).
    return [];
  }

  const now = new Date();
  const jobs: ScheduledJob[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) continue; // env assignment (PATH=, MAILTO=, ...)

    const parsed = parseCronLine(trimmed, now);
    if (parsed) jobs.push(parsed);
  }
  return jobs;
}

const CRON_SHORTHAND: Record<string, string[]> = {
  '@yearly': ['0', '0', '1', '1', '*'],
  '@annually': ['0', '0', '1', '1', '*'],
  '@monthly': ['0', '0', '1', '*', '*'],
  '@weekly': ['0', '0', '*', '*', '0'],
  '@daily': ['0', '0', '*', '*', '*'],
  '@midnight': ['0', '0', '*', '*', '*'],
  '@hourly': ['0', '*', '*', '*', '*'],
};

function parseCronLine(line: string, now: Date): ScheduledJob | null {
  let fields: string[];
  let command: string;

  if (line.startsWith('@')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx < 0) return null;
    const shorthand = line.slice(0, spaceIdx);
    command = line.slice(spaceIdx + 1).trim();

    if (shorthand === '@reboot') {
      return buildCronJob(line, command, { plain: 'At reboot', cadence: 'other' }, null);
    }
    const mapped = CRON_SHORTHAND[shorthand];
    if (!mapped) return null;
    fields = mapped;
  } else {
    const parts = line.split(/\s+/);
    if (parts.length < 6) return null;
    fields = parts.slice(0, 5);
    command = parts.slice(5).join(' ');
  }

  const [minF, hourF, domF, monF, dowF] = fields;
  const schedule = describeCronFields(minF, hourF, domF, monF, dowF);
  const nextRun = computeCronNext(fields, now);
  return buildCronJob(line, command, schedule, nextRun);
}

function buildCronJob(line: string, command: string, schedule: Schedule, nextRun: string | null): ScheduledJob {
  const id = `cron-${createHash('sha1').update(line).digest('hex').slice(0, 16)}`;
  return {
    id,
    kind: 'cron',
    name: command,
    schedulePlain: schedule.plain,
    cadence: schedule.cadence,
    lastRun: 'not recorded', // Must 25: cron keeps no run history, ever.
    lastResult: 'not recorded',
    nextRun,
    launchesFleetJob: command.includes('sam-dispatch'),
  };
}

// --- cron field parsing: *, lists, ranges, steps -----------------------------

type FieldParse =
  | { kind: 'star' }
  | { kind: 'star-step'; step: number }
  | { kind: 'fixed'; value: number }
  | { kind: 'list'; values: number[] }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'range-step'; from: number; to: number; step: number }
  | { kind: 'other' };

function parseCronField(raw: string): FieldParse {
  if (raw === '*') return { kind: 'star' };

  const stepMatch = raw.match(/^(\*|\d+-\d+)\/(\d+)$/);
  if (stepMatch) {
    const step = Number(stepMatch[2]);
    if (stepMatch[1] === '*') return { kind: 'star-step', step };
    const [from, to] = stepMatch[1].split('-').map(Number);
    return { kind: 'range-step', from, to, step };
  }
  if (/^\d+-\d+$/.test(raw)) {
    const [from, to] = raw.split('-').map(Number);
    return { kind: 'range', from, to };
  }
  if (/^\d+(,\d+)*$/.test(raw)) {
    const values = raw.split(',').map(Number);
    return values.length === 1 ? { kind: 'fixed', value: values[0] } : { kind: 'list', values };
  }
  return { kind: 'other' };
}

function fieldMatches(parsed: FieldParse, value: number): boolean {
  switch (parsed.kind) {
    case 'star':
      return true;
    case 'fixed':
      return parsed.value === value;
    case 'list':
      return parsed.values.includes(value);
    case 'range':
      return value >= parsed.from && value <= parsed.to;
    case 'star-step':
      return value % parsed.step === 0;
    case 'range-step':
      return value >= parsed.from && value <= parsed.to && (value - parsed.from) % parsed.step === 0;
    case 'other':
      return false;
  }
}

/** Cron's day-of-week is 0-7, both 0 and 7 meaning Sunday; JS `Date#getDay()` is 0-6. */
function dowFieldMatches(parsed: FieldParse, jsDay: number): boolean {
  const isoDay = jsDay === 0 ? 7 : jsDay;
  if (fieldMatches(parsed, isoDay)) return true;
  if (jsDay === 0 && fieldMatches(parsed, 0)) return true;
  return false;
}

function parseDowField(raw: string): Set<number> | null {
  const parsed = parseCronField(raw);
  const norm = (v: number) => (v % 7 === 0 ? 7 : v % 7); // 0 and 7 both -> 7 (Sun); 1..6 stay
  if (parsed.kind === 'fixed') return new Set([norm(parsed.value)]);
  if (parsed.kind === 'list') return new Set(parsed.values.map(norm));
  if (parsed.kind === 'range') {
    const set = new Set<number>();
    for (let v = parsed.from; v <= parsed.to; v++) set.add(norm(v));
    return set;
  }
  return null;
}

function fixedTimeLabel(hour: FieldParse, minute: FieldParse): string | null {
  if (hour.kind === 'fixed' && minute.kind === 'fixed') return `${pad2(hour.value)}:${pad2(minute.value)}`;
  return null;
}

function describeCronFields(minF: string, hourF: string, domF: string, monF: string, dowF: string): Schedule {
  const raw = `${minF} ${hourF} ${domF} ${monF} ${dowF}`;
  if (domF !== '*' || monF !== '*') return { plain: raw, cadence: 'other' };

  const min = parseCronField(minF);
  const hour = parseCronField(hourF);

  if (dowF !== '*') {
    const days = parseDowField(dowF);
    if (!days) return { plain: raw, cadence: 'other' };
    const timeLabel = fixedTimeLabel(hour, min);
    const isWeekdayOnly = days.size === 5 && [1, 2, 3, 4, 5].every((d) => days.has(d));
    if (isWeekdayOnly) return { plain: timeLabel ? `Weekdays at ${timeLabel}` : raw, cadence: 'weekday' };
    return { plain: timeLabel ? `${describeDaySet(days)} at ${timeLabel}` : raw, cadence: 'weekly' };
  }

  if (hour.kind === 'star') {
    if (min.kind === 'star') return { plain: 'Every minute', cadence: 'frequent' };
    if (min.kind === 'star-step') return { plain: `Every ${min.step} min`, cadence: 'frequent' };
    if (min.kind === 'fixed') return { plain: 'Hourly', cadence: 'frequent' };
    return { plain: raw, cadence: 'other' };
  }
  if (hour.kind === 'star-step' && min.kind === 'fixed') {
    if (hour.step >= 2 && hour.step < 24) return { plain: `Every ${hour.step} hours`, cadence: 'hours' };
    return { plain: raw, cadence: 'other' };
  }
  if (hour.kind === 'fixed' && min.kind === 'fixed') {
    return { plain: `Daily at ${pad2(hour.value)}:${pad2(min.value)}`, cadence: 'daily' };
  }
  return { plain: raw, cadence: 'other' };
}

/**
 * The next run after `from`, in local time, computed directly (no
 * minute-by-minute brute force — this runs on every poll). Walks forward a
 * day at a time (bounded to just over 4 years, enough to cross a leap-year
 * gap for a 29 Feb schedule), and within each day candidate checks only the
 * minute/hour combinations that already match those two fields. Returns
 * null when a field can't be parsed at all, or no match turns up within the
 * bound (both honest "can't compute" answers, never a guess).
 */
function computeCronNext(fields: string[], from: Date): string | null {
  const [minF, hourF, domF, monF, dowF] = fields;
  const min = parseCronField(minF);
  const hour = parseCronField(hourF);
  const dom = parseCronField(domF);
  const mon = parseCronField(monF);
  const dow = parseCronField(dowF);
  if ([min, hour, dom, mon, dow].some((f) => f.kind === 'other')) return null;

  const minutes = range(0, 59).filter((v) => fieldMatches(min, v));
  const hours = range(0, 23).filter((v) => fieldMatches(hour, v));
  if (minutes.length === 0 || hours.length === 0) return null;

  const domRestricted = domF !== '*';
  const dowRestricted = dowF !== '*';

  const cutoff = new Date(from.getTime());
  cutoff.setSeconds(0, 0);
  cutoff.setMinutes(cutoff.getMinutes() + 1);

  const todayMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const MAX_DAYS = 4 * 366 + 2;

  for (let i = 0; i <= MAX_DAYS; i++) {
    const day = new Date(todayMidnight.getFullYear(), todayMidnight.getMonth(), todayMidnight.getDate() + i);

    if (!fieldMatches(mon, day.getMonth() + 1)) continue;

    const domOk = fieldMatches(dom, day.getDate());
    const dowOk = dowFieldMatches(dow, day.getDay());
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domRestricted ? domOk : dowRestricted ? dowOk : true;
    if (!dayOk) continue;

    for (const h of hours) {
      for (const m of minutes) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        if (candidate.getTime() >= cutoff.getTime()) return candidate.toISOString();
      }
    }
  }
  return null;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v++) out.push(v);
  return out;
}
