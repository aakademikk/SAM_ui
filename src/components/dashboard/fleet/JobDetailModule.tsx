'use client';

/**
 * SAM — Job detail module (Modules A, T9).
 *
 * For the selected job: its name, General, model tier, stages done out of
 * stages planned (or "no stage data", Must 17), elapsed time and cost. No
 * percentage bars (Must 14).
 *
 * ux-fixes T8/T35: name and model tier come first off `FloorWorker.summary`
 * /`FloorWorker.tier` (`floorState.ts` reads these from `meta.json`'s own
 * `summary` field — written by `sam-job --summary` — and `tier` field —
 * ux-fixes T4). Only when the worker carries neither does this fall back to the
 * legacy `fleet:<persona> (<model>) — <brief>` convention (the Fleet page's
 * Dispatch button): the component cross-references `/api/fleet/jobs?persona=
 * <general>` and parses the command, and hands the result to `formatJobDetail`
 * as its optional `meta` argument. The new fields always win; "unknown" only
 * when neither source has anything. "Stage n of m" numbers the CURRENT stage
 * (the running stage's 1-based index, else the number done), matching the
 * floor canvas label. The "Last:" age is plain relative time ("40 s ago",
 * "5 min ago", "2 h ago"). Cost and elapsed come straight off the worker
 * (`costUsd` is already `costFleetJob`'s own figure — see `floorState.ts` — so
 * it can never disagree with `/api/fleet/spend` or `/api/fleet/jobs` for the
 * same job, Must 15).
 */

import { useEffect, useState } from 'react';

import { formatCost } from '@/lib/costing';
import type { FleetPersonaJob } from '@/types/fleet';
import type { FloorState, FloorWorker, FloorWorkerStatus, GeneralId } from '@/types/floor';

const GENERAL_LABELS: Record<GeneralId, string> = {
  hermes: 'Hermes',
  hephaestus: 'Hephaestus',
  calliope: 'Calliope',
  cerberus: 'Cerberus',
  prometheus: 'Prometheus',
};

const STATUS_COLOUR: Record<FloorWorkerStatus, string> = {
  queued: '#5f7d6e',
  running: '#3dff5a',
  verifying: '#2dd4bf',
  done: '#9dff70',
  failed: '#ff7a70',
};

function statusLabel(status: FloorWorkerStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'verifying':
      return 'Verifying';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

/** The `fleet:<persona> (<model>) — <brief>` convention's brief half, same shape as the dispatch route's own label. */
const BRIEF_RE = /^fleet:[a-z0-9_-]+(?:\s*\([^)]*\))?\s*[—-]\s*(.+)$/;

export function briefFromCommand(command: string): string | null {
  const match = command.match(BRIEF_RE);
  return match ? match[1].trim() : null;
}

/**
 * What the legacy `fleet:` convention (via `/api/fleet/jobs`) honestly resolved
 * for a job — used by `formatJobDetail` only as a FALLBACK when the worker has
 * no `summary`/`tier` of its own (ux-fixes T35). Also what
 * `GeneralDetailPanel.tsx`'s call site builds.
 */
export interface ResolvedJobMeta {
  /** The dispatch brief, or null when the job's command doesn't carry one. */
  name: string | null;
  /** The model tier the job was dispatched on, or null when unknown. */
  modelTier: string | null;
}

export interface JobDetailView {
  jobId: string;
  name: string;
  general: string;
  modelTier: string;
  statusLabel: string;
  statusColour: string;
  stagesLabel: string;
  elapsed: string;
  cost: string;
  /**
   * The full "Last: <description> · <age> ago" line (T7's `lastAction`), or
   * `null` when the job has no `action` event yet — omitted entirely by the
   * renderer, never shown as "Last: unknown" (Must 6).
   */
  last: string | null;
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Plain relative age: "40 s", "5 min", "2 h" (floored; never mm:ss). Callers
 * append " ago".
 */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

/**
 * Pure formatter: `FloorWorker` → display strings. No percentage bars, no
 * stage guesses — a job with no `stagesPlanned` reports "no stage data"
 * (Must 17), never an invented count. `cost` is `formatCost(worker.costUsd)`
 * verbatim — the same function and the same number the Fleet pages use — so
 * it can never read differently here (Must 15). `name`/`modelTier` come
 * from `worker.summary`/`worker.tier` first (ux-fixes T8); only when absent
 * does the optional legacy `meta` (ux-fixes T35) fill in; "unknown" when
 * neither has anything — never guessed.
 *
 * `now` is injectable so the "Last:" age is testable.
 */
export function formatJobDetail(
  worker: FloorWorker,
  meta: ResolvedJobMeta | null = null,
  now: number = Date.now(),
): JobDetailView {
  const name = worker.summary?.trim() || meta?.name?.trim() || 'unknown';
  const modelTier = worker.tier?.trim() || meta?.modelTier?.trim() || 'unknown';

  // Current-stage numbering, same as the floor canvas label (floorRender.ts
  // workerLines): the running stage's 1-based index, else the number done.
  const planned = worker.stagesPlanned?.length ?? 0;
  const stageList = worker.stages ?? [];
  const nowIdx = stageList.findIndex((s) => s.state === 'now');
  const stagesDone = stageList.filter((s) => s.state === 'done').length;
  const stagesLabel =
    planned > 0
      ? `Stage ${Math.min(planned, nowIdx >= 0 ? nowIdx + 1 : stagesDone)} of ${planned}`
      : 'no stage data';

  // T7's `lastAction` is optional *and* nullable — both "not set" and
  // "explicitly null" mean the same thing here: no real `action` event yet,
  // so the line is omitted entirely (Must 6), never "Last: unknown".
  const last = worker.lastAction
    ? `Last: ${worker.lastAction.description} · ${formatAge(now - Date.parse(worker.lastAction.at))} ago`
    : null;

  return {
    jobId: worker.jobId,
    name,
    general: worker.general === 'sam' ? 'SAM' : GENERAL_LABELS[worker.general],
    modelTier,
    statusLabel: statusLabel(worker.status),
    statusColour: STATUS_COLOUR[worker.status],
    stagesLabel,
    elapsed: formatElapsed(worker.elapsedMs),
    cost: worker.costUsd === null ? 'unknown' : formatCost(worker.costUsd),
    last,
  };
}

function findWorker(state: FloorState | null, jobId: string | null): FloorWorker | null {
  if (!state || !jobId) return null;
  for (const general of ['hermes', 'hephaestus', 'calliope', 'cerberus', 'prometheus'] as const) {
    const hit = state.generals[general].workers.find((w) => w.jobId === jobId);
    if (hit) return hit;
  }
  return state.samWorkers.find((w) => w.jobId === jobId) ?? null;
}

interface JobsEnvelope {
  data?: { persona: string; jobs: FleetPersonaJob[] };
}

function isJobsPayload(value: unknown): value is { persona: string; jobs: FleetPersonaJob[] } {
  const v = value as { persona: string; jobs: FleetPersonaJob[] } | null;
  return !!v && typeof v === 'object' && Array.isArray(v.jobs);
}

export interface JobDetailModuleProps {
  /** The floor's current state, from a parent that already polls `/api/fleet/floor` (T5/T11). */
  state: FloorState | null;
  selectedJobId: string | null;
  /** Demo mode (T20): appends `demo=1` to the legacy `/api/fleet/jobs` lookup. */
  demo?: boolean;
  className?: string;
}

export default function JobDetailModule({ state, selectedJobId, demo = false, className }: JobDetailModuleProps) {
  const worker = findWorker(state, selectedJobId);
  // Primitive deps only: `worker` is a fresh object every poll, so depending
  // on it would re-fetch every few seconds. The legacy lookup is needed only
  // when the worker has no `summary`/`tier` of its own (ux-fixes T35).
  const jobId = worker?.jobId ?? null;
  const general = worker?.general ?? null;
  const needsLegacy = !!worker && !(worker.summary?.trim() && worker.tier?.trim());
  const [meta, setMeta] = useState<ResolvedJobMeta | null>(null);

  useEffect(() => {
    if (!jobId || !general || general === 'sam' || !needsLegacy) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    const url = `/api/fleet/jobs?persona=${encodeURIComponent(general)}` + (demo ? '&demo=1' : '');

    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        if (!res.ok) return;
        const json = (await res.json()) as JobsEnvelope;
        if (cancelled || !isJobsPayload(json.data)) return;
        const match = json.data.jobs.find((j) => j.id === jobId);
        if (!match) {
          setMeta(null);
          return;
        }
        setMeta({ name: briefFromCommand(match.command), modelTier: match.model || null });
      } catch {
        // No live lookup this round — "unknown" stands, never a guess.
      }
    })();

    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [jobId, general, demo, needsLegacy]);

  if (!worker) {
    return (
      <section
        aria-label="Job detail"
        className={`rounded-xl border px-3.5 py-3 ${className ?? ''}`}
        style={{
          background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
          borderColor: 'rgba(61,255,90,.12)',
        }}
      >
        <span className="text-[12px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Job detail
        </span>
        <p className="mt-2 text-[12px]" style={{ color: '#5f7d6e' }}>
          Select a job to see its detail.
        </p>
      </section>
    );
  }

  const view = formatJobDetail(worker, meta);

  return (
    <section
      aria-label="Job detail"
      className={`rounded-xl border px-3.5 py-3 ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
      }}
    >
      <header className="flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Job detail
        </span>
        <span
          className="flex items-center gap-1.5 text-[12px] font-semibold"
          style={{ color: view.statusColour }}
        >
          <i aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: view.statusColour }} />
          {view.statusLabel}
        </span>
      </header>

      <h3 className="mt-1.5 truncate text-[16px] font-semibold" style={{ color: '#e8f7ee' }}>
        {view.name}
      </h3>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Pill>{view.general}</Pill>
        <Pill>{view.modelTier}</Pill>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-2.5" style={{ borderColor: 'rgba(157,255,112,.075)' }}>
        <Stat label="Stages" value={view.stagesLabel} />
        <Stat label="Elapsed" value={view.elapsed} />
        <Stat label="Cost" value={view.cost} accent />
      </dl>

      {view.last ? (
        <p className="mt-2 truncate text-[12px]" style={{ color: '#5f7d6e' }}>
          {view.last}
        </p>
      ) : null}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-full border px-2 py-[3px] text-[12px] font-medium"
      style={{ borderColor: 'rgba(157,255,112,.16)', color: '#98b6a6' }}
    >
      {children}
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] tracking-wide uppercase" style={{ color: '#5f7d6e' }}>
        {label}
      </dt>
      <dd
        className="truncate text-[13px] font-semibold tabular-nums"
        style={{ color: accent ? '#3dff5a' : '#e8f7ee' }}
      >
        {value}
      </dd>
    </div>
  );
}
