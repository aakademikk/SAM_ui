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
 * with its Esc hint, the blurb, the now-line, three stats, the workers
 * running now and the jobs earlier today. Everything shown is real: the
 * workers come from `FloorState` (the same poll the floor draws), names,
 * models and costs from `/api/fleet/jobs` (the same `costFleetJob` costing
 * as the spend scan, Must 15). The mockup's "Median time" and "Models"
 * have no live source, so they are left out rather than invented.
 */

import { useEffect, useState } from 'react';

import { BUST_PATHS } from '@/lib/busts';
import { formatCost } from '@/lib/costing';
import type { FloorState, FloorWorker, GeneralId } from '@/types/floor';
import type { FleetPersonaJob } from '@/types/fleet';
import { formatJobDetail, formatElapsed } from './JobDetailModule';

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

/** The `fleet:<persona> (<model>) — <brief>` label's brief half (the convention `/api/fleet/dispatch` sets). */
const BRIEF_RE = /^fleet:[a-z0-9_-]+(?:\s*\([^)]*\))?\s*[—-]\s*(.+)$/;
function briefOf(command: string): string | null {
  const m = command.match(BRIEF_RE);
  return m ? m[1].trim() : null;
}

/** HH:MM in UTC, so the times agree with the top bar's UTC clock. */
function hhmmUtc(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) : '--:--';
}

function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface GeneralSummary {
  name: string;
  role: string;
  blurb: string;
  busy: boolean;
  workers: FloorWorker[];
  verifiedToday: number;
  /** Spend on this General's jobs created today, from `/api/fleet/jobs`; null until it has loaded. */
  spendToday: number | null;
  /** True when `/api/fleet/jobs`'s capped list may not reach back to midnight, so the spend is a floor, not a total. */
  spendPartial: boolean;
  /** Finished jobs created today, newest first (at most four). */
  earlier: FleetPersonaJob[];
}

/**
 * Pure: everything the panel shows about one General. `jobs` is the
 * `/api/fleet/jobs?persona=` list (newest first, capped by the route), or
 * null while it has not loaded.
 */
export function summariseGeneral(
  state: FloorState | null,
  id: GeneralId,
  jobs: FleetPersonaJob[] | null,
  now: number,
  routeCap = 10,
): GeneralSummary {
  const info = GENERAL_INFO[id];
  const g = state?.generals[id];
  const workers = g?.workers ?? [];
  const live = new Set(workers.map((w) => w.jobId));
  const dayStart = startOfLocalDay(now);
  const today = (jobs ?? []).filter((j) => {
    const t = Date.parse(j.createdAt);
    return Number.isFinite(t) && t >= dayStart;
  });
  const spendToday = jobs ? today.reduce((sum, j) => sum + (j.costUsd ?? 0), 0) : null;
  // the route returns at most `routeCap` jobs; if all of them are from today, older ones today may be missing
  const spendPartial = !!jobs && jobs.length >= routeCap && today.length === jobs.length;
  const earlier = today.filter((j) => !live.has(j.id) && j.status !== 'queued' && j.status !== 'running').slice(0, 4);
  return {
    ...info,
    busy: g ? !g.idle : false,
    workers,
    verifiedToday: state?.towers[id] ?? 0,
    spendToday,
    spendPartial,
    earlier,
  };
}

interface JobsEnvelope {
  data?: { persona: string; jobs: FleetPersonaJob[] };
}

export interface GeneralDetailPanelProps {
  general: GeneralId;
  /** The floor's current state, shared from the shell's single poll. */
  state: FloorState | null;
  onClose: () => void;
  /** Demo mode (T20): appends `demo=1` to the `/api/fleet/jobs` lookup. */
  demo?: boolean;
  className?: string;
}

export default function GeneralDetailPanel({ general, state, onClose, demo = false, className }: GeneralDetailPanelProps) {
  const [jobs, setJobs] = useState<{ general: GeneralId; list: FleetPersonaJob[] } | null>(null);

  // names, models and costs for this General's jobs; refreshed while the panel is open
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctl: AbortController | null = null;
    const url = `/api/fleet/jobs?persona=${encodeURIComponent(general)}` + (demo ? '&demo=1' : '');
    const load = async () => {
      ctl = new AbortController();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        if (res.ok) {
          const json = (await res.json()) as JobsEnvelope;
          if (!stopped && json.data && Array.isArray(json.data.jobs)) setJobs({ general, list: json.data.jobs });
        }
      } catch {
        // keep what we had; the next round tries again
      }
      if (!stopped) timer = setTimeout(load, 10_000);
    };
    void load();
    return () => { stopped = true; if (timer) clearTimeout(timer); ctl?.abort(); };
  }, [general, demo]);

  const list = jobs && jobs.general === general ? jobs.list : null;
  const s = summariseGeneral(state, general, list, Date.now());
  const byId = new Map((list ?? []).map((j) => [j.id, j]));
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
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase" style={{ color: C.accent }}>
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
          <kbd className="rounded border px-1.5 py-px font-mono text-[11px]" style={{ borderColor: C.line, color: C.muted }}>
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

      <div className="mt-3.5 grid grid-cols-3 gap-2 border-t pt-3" style={{ borderColor: C.line }}>
        <Stat label="Running" value={String(s.workers.length)} />
        <Stat label="Verified" value={String(s.verifiedToday)} />
        <Stat
          label="Spend today"
          value={s.spendToday === null ? '—' : (s.spendPartial ? '≥ ' : '') + formatCost(s.spendToday)}
        />
      </div>

      {s.workers.length > 0 ? (
        <>
          <SectionHead title="Workers now" />
          <ul className="flex list-none flex-col gap-0.5 p-0">
            {s.workers.map((w) => {
              const view = formatJobDetail(w, byId.has(w.jobId) ? { name: briefOf(byId.get(w.jobId)!.command), modelTier: byId.get(w.jobId)!.model || null } : null);
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
                  <em className="shrink-0 text-[11px] not-italic" style={{ color: now ? C.accent : C.faint }}>
                    {view.modelTier === 'unknown' ? view.statusLabel : `${view.modelTier} · ${view.statusLabel}`}
                    {view.stagesLabel === 'no stage data' ? '' : ` · ${view.stagesLabel}`} · {view.elapsed}
                  </em>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {s.earlier.length > 0 ? (
        <>
          <SectionHead title="Earlier today" />
          <ul className="list-none p-0">
            {s.earlier.map((j, i) => {
              const ok = j.status === 'exited' && j.exitCode === 0;
              const label = ok ? 'Done' : j.status === 'killed' || j.status === 'stopped' ? 'Stopped' : 'Failed';
              const dur = j.endedAt ? formatElapsed(Date.parse(j.endedAt) - Date.parse(j.createdAt)) : null;
              return (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-2 py-1.5 text-[12px]"
                  style={{ borderTop: i ? `1px solid ${C.line}` : undefined }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{briefOf(j.command) ?? `Job ${j.id.slice(0, 8)}`}</span>
                    <small className="mt-px block truncate text-[11px]" style={{ color: C.faint }}>
                      {hhmmUtc(j.createdAt)}
                      {j.model ? ` · ${j.model}` : ''}
                      {dur ? ` · ${dur}` : ''}
                      {j.costUsd !== null ? ` · ${formatCost(j.costUsd)}` : ''}
                    </small>
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-[5px] rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.06em] uppercase"
                    style={{ color: ok ? C.ok : C.bad, background: ok ? C.okBg : C.badBg }}
                  >
                    <i aria-hidden className="inline-block size-[5px] rounded-full" style={{ background: 'currentColor' }} />
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="mb-[3px] block truncate text-[11px] tracking-[0.08em] uppercase" style={{ color: C.faint }}>
        {label}
      </span>
      <b className="block truncate text-[15px] font-semibold tabular-nums">{value}</b>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <div
      className="mt-3.5 mb-2 text-[11px] font-semibold tracking-[0.1em] uppercase"
      style={{ color: C.faint }}
    >
      {title}
    </div>
  );
}
