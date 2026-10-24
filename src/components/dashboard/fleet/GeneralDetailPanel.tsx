'use client';

/**
 * SAM — a General's zoom/detail panel (T11, Must 4).
 *
 * Opened by clicking a General anywhere on the fleet dashboard (its station
 * or card on the floor, its Fleet status row, an Active jobs row). On the
 * desktop layout it covers the right-hand column; in the small-laptop drawer
 * it takes the drawer's place. Esc, the Back button, or a click on empty
 * floor closes it (handled by `FleetDashboardShell`).
 *
 * A port of the design source's `focusHTML` (engine.js) and `#p-focus`
 * styling (e-hybrid.html): the large bust, "General · <role>", name, Back
 * with its Esc hint, the blurb, the now-line, two stats, the workers
 * running now and the General's last five finished jobs. Everything shown is
 * real: the workers come from `FloorState` (the same poll the floor draws),
 * their names and models from each job's own `summary` and `tier`; the last
 * five finished from the finished-jobs poller (completed-jobs T11, T12),
 * in the same row format as the fleet list. The mockup's "Median time" and
 * "Models" have no live source, so they are left out rather than invented.
 */

import { BUST_PATHS } from '@/lib/busts';
import type { FinishedJob } from '@/types/finishedJobs';
import { GENERAL_LIST_CAP } from '@/types/finishedJobs';
import type { FloorState, FloorWorker, GeneralId } from '@/types/floor';
import FinishedJobsList from './FinishedJobsList';
import { formatJobDetail } from './JobDetailModule';
import { useFinishedJobs } from './useFinishedJobs';

const GENERAL_INFO: Record<GeneralId, { name: string; role: string; blurb: string }> = {
  hermes: { name: 'Hermes', role: 'Growth', blurb: 'Lead generation, outreach and pipeline.' },
  hephaestus: { name: 'Hephaestus', role: 'Delivery', blurb: 'Website prototypes and production builds.' },
  calliope: { name: 'Calliope', role: 'Marketing', blurb: 'Ads, campaigns and content.' },
  cerberus: { name: 'Cerberus', role: 'Security', blurb: 'Audits, threat monitoring and authorised pen testing.' },
  prometheus: { name: 'Prometheus', role: 'R&D', blurb: 'Model benchmarking, efficiency and self-improvement.' },
};

const C = {
  text: '#e8f7ee',
  muted: '#98b6a6',
  faint: '#5f7d6e',
  accent: '#3dff5a',
  accentBg: 'rgba(61,255,90,.085)',
  accentLine: 'rgba(61,255,90,.34)',
  ok: '#9dff70',
  okBg: 'rgba(157,255,112,.09)',
  bad: '#ff7a70',
  badBg: 'rgba(255,122,112,.1)',
  chip: 'rgba(157,255,112,.06)',
  line: 'rgba(157,255,112,.075)',
  lineStrong: 'rgba(157,255,112,.16)',
  idle: '#27463a',
};

export interface GeneralSummary {
  name: string;
  role: string;
  blurb: string;
  busy: boolean;
  workers: FloorWorker[];
  verifiedToday: number;
  /** The General's last five finished jobs, newest first; empty until they have loaded. */
  finished: FinishedJob[];
}

/**
 * Pure: everything the panel shows about one General. `finished` is the
 * `/api/fleet/finished-jobs?general=` list (newest first, already capped by
 * the route), or null while it has not loaded.
 */
export function summariseGeneral(
  state: FloorState | null,
  id: GeneralId,
  finished: FinishedJob[] | null,
): GeneralSummary {
  const info = GENERAL_INFO[id];
  const g = state?.generals[id];
  // the route already sorts and caps; kept here so the panel cannot show more than five or out of order
  const last = [...(finished ?? [])]
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
    .slice(0, GENERAL_LIST_CAP);
  return {
    ...info,
    busy: g ? !g.idle : false,
    workers: g?.workers ?? [],
    verifiedToday: state?.towers[id] ?? 0,
    finished: last,
  };
}

export interface GeneralDetailPanelProps {
  general: GeneralId;
  /** The floor's current state, shared from the shell's single poll. */
  state: FloorState | null;
  onClose: () => void;
  /** Demo mode (T20): appends `demo=1` to the finished-jobs poll, so the live job store is never read. */
  demo?: boolean;
  className?: string;
}

export default function GeneralDetailPanel({ general, state, onClose, demo = false, className }: GeneralDetailPanelProps) {
  // this General's last five finished; the poller pauses with the tab and drops rows from another General
  const { jobs } = useFinishedJobs({ general, demo });
  return <GeneralDetailView general={general} state={state} finished={jobs} onClose={onClose} className={className} />;
}

export interface GeneralDetailViewProps {
  general: GeneralId;
  state: FloorState | null;
  /** The finished-jobs poll's rows for this General, or null until it has answered. */
  finished: FinishedJob[] | null;
  onClose: () => void;
  className?: string;
}

/** The panel itself, without its poll, so a static render can be given rows. */
export function GeneralDetailView({ general, state, finished, onClose, className }: GeneralDetailViewProps) {
  const s = summariseGeneral(state, general, finished);
  const bust = BUST_PATHS[general].large ?? BUST_PATHS[general].small;
  const mask =
    'linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent) center/168px 168px no-repeat,' +
    'linear-gradient(transparent,#000 5%,#000 95%,transparent) center/168px 168px no-repeat';

  return (
    <section
      aria-label={`${s.name} detail`}
      data-general={general}
      className={`rounded-xl border px-[18px] py-4 text-[12.5px] leading-[1.35] ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
        color: C.text,
        backdropFilter: 'blur(14px) saturate(130%)',
      }}
    >
      {/* the large bust, its black background dropped by the screen blend (e-hybrid.html #p-focus::before) */}
      <div
        aria-hidden
        className="fd-bust"
        style={{
          height: 168,
          margin: '-6px 0 6px',
          background: `url(${bust}) center/contain no-repeat`,
          mixBlendMode: 'screen',
          opacity: s.busy ? 1 : 0.6,
          transition: 'opacity .3s',
          WebkitMask: mask,
          WebkitMaskComposite: 'source-in',
          mask,
          maskComposite: 'intersect',
        }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.accent }}>
            General · {s.role}
          </div>
          <h2 className="fd-fx-name mt-0.5 text-[26px] leading-tight font-semibold tracking-[-0.02em]">{s.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-back
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{ background: C.chip, borderColor: C.lineStrong, color: C.text }}
        >
          Back
          <kbd className="rounded border px-1.5 py-px font-mono text-[12px]" style={{ borderColor: C.line, color: C.muted }}>
            Esc
          </kbd>
        </button>
      </div>

      <p className="mt-2 mb-3 text-[13px]" style={{ color: C.muted }}>
        {s.blurb}
      </p>

      <div
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px]"
        style={{ background: s.busy ? C.accentBg : C.chip, color: s.busy ? C.text : C.muted }}
      >
        <i
          aria-hidden
          className="inline-block size-[7px] shrink-0 rounded-full"
          style={{ background: s.busy ? C.accent : C.idle, boxShadow: s.busy ? `0 0 8px ${C.accent}` : 'none' }}
        />
        {s.busy
          ? `Working · ${s.workers.length} ${s.workers.length === 1 ? 'job' : 'jobs'} running`
          : 'Idle. No workers running.'}
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2 border-t pt-3" style={{ borderColor: C.line }}>
        <Stat label="Running" value={String(s.workers.length)} />
        <Stat label="Verified" value={String(s.verifiedToday)} />
      </div>

      {s.workers.length > 0 ? (
        <>
          <SectionHead title="Workers now" />
          <ul className="flex list-none flex-col gap-0.5 p-0">
            {s.workers.map((w) => {
              const view = formatJobDetail(w);
              const now = w.status === 'running';
              return (
                <li
                  key={w.jobId}
                  className="flex items-center gap-2.5 rounded-md px-2 py-[5px] text-[12px]"
                  style={{ background: now ? C.accentBg : 'transparent', color: now ? C.text : C.muted }}
                >
                  <i
                    aria-hidden
                    className="inline-block size-2 shrink-0 rounded-[2px] border-[1.5px]"
                    style={{
                      background: now ? C.accent : 'transparent',
                      borderColor: now ? C.accent : C.lineStrong,
                      boxShadow: now ? `0 0 10px ${C.accent}` : 'none',
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{view.name === 'unknown' ? `Job ${w.jobId.slice(0, 8)}` : view.name}</span>
                  <em className="shrink-0 text-[12px] not-italic" style={{ color: now ? C.accent : C.faint }}>
                    {view.modelTier === 'unknown' ? view.statusLabel : `${view.modelTier} · ${view.statusLabel}`}
                    {view.stagesLabel === 'no stage data' ? '' : ` · ${view.stagesLabel}`} · {view.elapsed}
                  </em>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {/* always present: rows once loaded, the one-line text for a General with none, nothing while loading */}
      <FinishedJobsList
        jobs={finished === null ? null : s.finished}
        title="Last 5 finished"
        showGeneral
        emptyText="No finished jobs yet"
        bare
        className="mt-3.5"
      />

      {/* below md the app's fixed bottom tab bar (TabBar: z-50, 3.5rem plus the safe area) lies over the phone sheet's
          bottom edge, so the panel ends with room the size of that bar to scroll its last row clear of it (T15 check 16).
          A spacer, not padding: the sheet zeroes this section's padding. Hidden from md, so the desktop overlay is unchanged. */}
      <div aria-hidden="true" data-nav-clearance className="h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:hidden" />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="mb-[3px] block truncate text-[12px] tracking-[0.08em] uppercase" style={{ color: C.faint }}>
        {label}
      </span>
      <b className="block truncate text-[15px] font-semibold tabular-nums">{value}</b>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div
      className="mt-3.5 mb-2 text-[12px] font-semibold tracking-[0.1em] uppercase"
      style={{ color: C.faint }}
    >
      {title}
    </div>
  );
}
