'use client';

/**
 * SAM — the Schedule panel (T18, Must 26; check 28).
 *
 * Opened by a transparent click/tap target over the clock ring (T17's
 * `onRing` extent; the shell places a keyboard-reachable button over it,
 * Tab + Enter). Lists every scheduled job from the floor's shared
 * `/api/fleet/schedule` poll (T16's `ScheduledJob[]`, handed down from
 * `FloorCanvas`'s `onSchedule` the shell already wires for the ring — the
 * panel never fetches on its own), sorted by next run. A port of the design
 * source's `panelHTML` (`e-scene.js`) onto the real data shape: each row's
 * name, plain-words schedule, last run with its ok/failed/running badge (or
 * the honest "not recorded", Must 25), and next run.
 *
 * It opens exactly where a General's detail opens (the desktop side panel,
 * the laptop drawer's Job tab, the phone's bottom sheet) — the shell and
 * phone view wire it into the same single-open-panel state `GeneralDetailPanel`
 * uses (T11's `dashboardLayout.ts`, T13's `phoneView.ts`), so the two can
 * never stack. Esc, Back or a click on empty floor close it the same way a
 * General's detail does.
 */

import type { ScheduledJob } from '@/types/floor';

const C = {
  text: '#e8f7ee',
  muted: '#98b6a6',
  faint: '#5f7d6e',
  accent: '#3dff5a',
  accentBg: 'rgba(61,255,90,.085)',
  ok: '#9dff70',
  okBg: 'rgba(157,255,112,.09)',
  bad: '#ff7a70',
  badBg: 'rgba(255,122,112,.1)',
  chip: 'rgba(157,255,112,.06)',
  line: 'rgba(157,255,112,.075)',
  lineStrong: 'rgba(157,255,112,.16)',
};

const COLS = 'minmax(0,1fr) 92px 84px';

/** HH:MM in UTC, so times agree with the top bar's UTC clock (same convention as `GeneralDetailPanel`). */
function hhmmUtc(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) : '--:--';
}

/**
 * Ascending by next run (Must 26). A job with no next run at all (e.g.
 * cron's `@reboot`, which T17 also leaves unplaced on the ring) sorts after
 * every job that has one, by name among themselves, so the order is stable
 * rather than arbitrary.
 */
export function sortByNextRun(jobs: ScheduledJob[]): ScheduledJob[] {
  const withTime = (j: ScheduledJob) => {
    const t = j.nextRun ? Date.parse(j.nextRun) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  return [...jobs].sort((a, b) => {
    const ta = withTime(a);
    const tb = withTime(b);
    if (ta === null && tb === null) return a.name.localeCompare(b.name);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });
}

export interface SchedulePanelProps {
  /** The ring's shared poll (`FloorCanvas`'s `onSchedule`); null until the first poll lands. */
  jobs: ScheduledJob[] | null;
  onClose: () => void;
  className?: string;
}

export default function SchedulePanel({ jobs, onClose, className }: SchedulePanelProps) {
  const list = sortByNextRun(jobs ?? []);
  const failed = list.filter((j) => j.lastResult === 'failed').length;

  return (
    <section
      aria-label="Schedule"
      className={`rounded-xl border px-[18px] py-4 text-[12.5px] leading-[1.35] ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
        color: C.text,
        backdropFilter: 'blur(14px) saturate(130%)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.accent }}>
            SAM · Clock ring
          </div>
          <h2 className="fd-fx-name mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Schedule</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-back
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{ background: C.chip, borderColor: C.lineStrong, color: C.text }}
        >
          Back
          <kbd className="rounded border px-1.5 py-px font-mono text-[11px]" style={{ borderColor: C.line, color: C.muted }}>
            Esc
          </kbd>
        </button>
      </div>

      {jobs === null ? (
        <p className="mt-3 text-[12px]" style={{ color: C.muted }}>
          Loading the schedule…
        </p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: C.muted }}>
          No scheduled jobs found.
        </p>
      ) : (
        <>
          <p className="mt-2 mb-3 text-[12px]" style={{ color: C.muted }}>
            {list.length} scheduled job{list.length === 1 ? '' : 's'}
            {failed > 0 ? (
              <>
                {' · '}
                <b style={{ color: C.bad }}>
                  {failed} failed
                </b>
              </>
            ) : null}
          </p>

          <div
            className="grid gap-2 border-b pb-[5px] text-[11px] font-semibold tracking-[0.08em] uppercase"
            style={{ gridTemplateColumns: COLS, borderColor: C.line, color: C.faint }}
          >
            <span>Job</span>
            <span className="text-right">Last run</span>
            <span className="text-right">Next run</span>
          </div>

          <ul className="m-0 list-none p-0">
            {list.map((j) => (
              <ScheduleRow key={j.id} job={j} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ScheduleRow({ job }: { job: ScheduledJob }) {
  const live = job.lastResult === 'running';
  const failed = job.lastResult === 'failed';
  return (
    <li
      className="grid items-center gap-2 border-b py-1.5 text-[12px]"
      style={{ gridTemplateColumns: COLS, borderColor: C.line }}
      data-schedule-id={job.id}
    >
      <div className="min-w-0">
        <span className="block truncate font-semibold" style={{ color: live ? C.accent : failed ? C.bad : C.text }}>
          {job.name}
        </span>
        <small className="block truncate text-[11px]" style={{ color: C.faint }}>
          {job.schedulePlain}
        </small>
      </div>
      <div className="flex flex-col items-end gap-0.5" style={{ color: C.muted }}>
        {live ? (
          <Badge label="running" colour={C.accent} bg={C.accentBg} />
        ) : job.lastResult === 'not recorded' ? (
          <span style={{ color: C.faint }}>not recorded</span>
        ) : (
          <>
            <span>{job.lastRun && job.lastRun !== 'not recorded' ? hhmmUtc(job.lastRun) : '--:--'}</span>
            <Badge label={failed ? 'failed' : 'ok'} colour={failed ? C.bad : C.ok} bg={failed ? C.badBg : C.okBg} />
          </>
        )}
      </div>
      <div className="text-right">
        {job.nextRun ? <b className="tabular-nums">{hhmmUtc(job.nextRun)}</b> : <span style={{ color: C.faint }}>not scheduled</span>}
      </div>
    </li>
  );
}

function Badge({ label, colour, bg }: { label: string; colour: string; bg: string }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase"
      style={{ color: colour, background: bg }}
    >
      <i aria-hidden className="inline-block size-[5px] rounded-full" style={{ background: 'currentColor' }} />
      {label}
    </span>
  );
}
