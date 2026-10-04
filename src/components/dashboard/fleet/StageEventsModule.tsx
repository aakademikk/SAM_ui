'use client';

/**
 * SAM — Stage events module (Modules B, T10).
 *
 * The live log of real stage events (Must 8): built from the state
 * transitions of each `FloorWorker.stages` (and each worker's own
 * queued/running/failed/vanished-means-done status) as `FloorState` changes
 * between the parent's polls of `/api/fleet/floor` (T1/T5) — never a
 * re-derived or invented timeline. `diffStageEvents` is the pure half: given
 * the previous poll's `FloorState`, the next one, and the time the diff ran,
 * it returns only the transitions that newly became true this poll. The
 * component keeps the last `maxEntries` of these client-side (default 40)
 * and renders them newest first.
 *
 * Three honest limits, all because the log can only report what two polls
 * actually showed it, never guess between them:
 *  - The very first poll logs nothing (same rule as `floorRender.diffFloor`
 *    for its own effects) — there is no "previous" to diff against.
 *  - A job's `stages` array (T1/T5) carries no per-stage timestamp, so a
 *    stage transition's logged time is "when this poll noticed it", not the
 *    real `stage-start`/`stage-done` event time. That is still within the
 *    "5 seconds, no reload" bound (Must 13) the poll interval already holds
 *    the floor to.
 *  - `readFloorState` drops a job from the floor entirely once it reaches
 *    `done` (Must 11 — "its proof returns to SAM"), so a completion can only
 *    be observed as the job vanishing from the list it was last seen live
 *    in. A job that disappears between MAX_SCAN's retention window and the
 *    next poll for an unrelated reason would be misread as "done" the same
 *    way `floorRender.diffFloor`'s own `ends` list already accepts for its
 *    teal return/slab effects — this log inherits that same accepted limit,
 *    not a new one.
 */

import { useEffect, useRef, useState } from 'react';

import type { FloorState, FloorStage, FloorWorker, FloorWorkerStatus, GeneralId } from '@/types/floor';

const GENERAL_IDS: readonly GeneralId[] = [
  'hermes',
  'hephaestus',
  'calliope',
  'cerberus',
  'prometheus',
];

const GENERAL_LABELS: Record<GeneralId, string> = {
  hermes: 'Hermes',
  hephaestus: 'Hephaestus',
  calliope: 'Calliope',
  cerberus: 'Cerberus',
  prometheus: 'Prometheus',
};

function generalLabel(general: GeneralId | 'sam'): string {
  return general === 'sam' ? 'SAM' : GENERAL_LABELS[general];
}

export type StageEventKind = 'queued' | 'running' | 'stage-start' | 'stage-done' | 'done' | 'failed';

export interface StageEventEntry {
  /** Stable React key and the test's own assertion key: `${jobId}:${kind}:${stage ?? ''}`. */
  id: string;
  /** When this poll observed the transition (ms epoch) — see the file doc comment's second honest limit. */
  at: number;
  jobId: string;
  general: GeneralId | 'sam';
  kind: StageEventKind;
  stage?: string;
  label: string;
}

interface WorkerInfo {
  general: GeneralId | 'sam';
  worker: FloorWorker;
}

function collectWorkers(state: FloorState): Map<string, WorkerInfo> {
  const byJob = new Map<string, WorkerInfo>();
  for (const id of GENERAL_IDS) {
    for (const worker of state.generals[id]?.workers ?? []) byJob.set(worker.jobId, { general: id, worker });
  }
  for (const worker of state.samWorkers ?? []) byJob.set(worker.jobId, { general: 'sam', worker });
  return byJob;
}

function statusKind(status: FloorWorkerStatus): StageEventKind | null {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    // 'done' never appears live (Must 11 drops it from the floor; the
    // vanished-job branch below is the only source of a 'done' entry) and
    // 'verifying' is a transient UI state `readFloorState` never emits
    // (`src/types/floor.ts`'s own doc comment on `FloorWorkerStatus`).
    default:
      return null;
  }
}

function statusLabel(kind: StageEventKind): string {
  switch (kind) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'failed':
      return 'Failed';
    case 'done':
      return 'Verified · done';
    case 'stage-start':
    case 'stage-done':
      return kind;
  }
}

function stageChanges(prevStages: FloorStage[] | null, nextStages: FloorStage[] | null): { stage: string; state: FloorStage['state'] }[] {
  if (!prevStages || !nextStages) return [];
  const prevByName = new Map(prevStages.map((s) => [s.name, s.state]));
  const changes: { stage: string; state: FloorStage['state'] }[] = [];
  for (const next of nextStages) {
    const before = prevByName.get(next.name);
    if (before !== undefined && before !== next.state && next.state !== 'todo') {
      changes.push({ stage: next.name, state: next.state });
    }
  }
  return changes;
}

/**
 * The transitions newly true between `prev` and `next` — nothing on the
 * first poll (`prev === null`), one entry per status change observed on a
 * job already seen before, one entry per stage that moved to `now` or
 * `done`, and one `done` entry per job that was live in `prev` and has
 * vanished from `next` entirely (see the file doc comment).
 */
export function diffStageEvents(prev: FloorState | null, next: FloorState, now: number): StageEventEntry[] {
  if (!prev) return [];

  const prevByJob = collectWorkers(prev);
  const nextByJob = collectWorkers(next);
  const entries: StageEventEntry[] = [];

  nextByJob.forEach((info, jobId) => {
    const prevInfo = prevByJob.get(jobId);
    if (!prevInfo) {
      // A job new to the floor this poll: log only its current status, never
      // a backfilled stage history we did not actually observe.
      const kind = statusKind(info.worker.status);
      if (kind) {
        entries.push({
          id: `${jobId}:${kind}:`,
          at: now,
          jobId,
          general: info.general,
          kind,
          label: `${generalLabel(info.general)} · ${statusLabel(kind)}`,
        });
      }
      return;
    }

    if (prevInfo.worker.status !== info.worker.status) {
      const kind = statusKind(info.worker.status);
      if (kind) {
        entries.push({
          id: `${jobId}:${kind}:`,
          at: now,
          jobId,
          general: info.general,
          kind,
          label: `${generalLabel(info.general)} · ${statusLabel(kind)}`,
        });
      }
    }

    for (const change of stageChanges(prevInfo.worker.stages, info.worker.stages)) {
      const kind: StageEventKind = change.state === 'done' ? 'stage-done' : 'stage-start';
      entries.push({
        id: `${jobId}:${kind}:${change.stage}`,
        at: now,
        jobId,
        general: info.general,
        kind,
        stage: change.stage,
        label: `${generalLabel(info.general)} · ${kind === 'stage-done' ? 'Stage done' : 'Stage started'}: ${change.stage}`,
      });
    }
  });

  // A job live in prev and absent from next has reached 'done' (Must 11).
  prevByJob.forEach((info, jobId) => {
    if (nextByJob.has(jobId)) return;
    if (info.worker.status === 'queued' || info.worker.status === 'running') {
      entries.push({
        id: `${jobId}:done:`,
        at: now,
        jobId,
        general: info.general,
        kind: 'done',
        label: `${generalLabel(info.general)} · ${statusLabel('done')}`,
      });
    }
  });

  return entries;
}

const KIND_COLOUR: Record<StageEventKind, string> = {
  queued: '#5f7d6e',
  running: '#3dff5a',
  'stage-start': '#9dff70',
  'stage-done': '#2dd4bf',
  done: '#2dd4bf',
  failed: '#ff7a70',
};

export interface StageEventsModuleProps {
  /** The floor's current state, from a parent that already polls `/api/fleet/floor` (T5/T11). Null before the first load. */
  state: FloorState | null;
  /** How many of the most recent transitions to keep client-side (default 40). */
  maxEntries?: number;
  className?: string;
}

export default function StageEventsModule({ state, maxEntries = 40, className }: StageEventsModuleProps) {
  const prevRef = useRef<FloorState | null>(null);
  const [log, setLog] = useState<StageEventEntry[]>([]);

  useEffect(() => {
    if (!state) return;
    const added = diffStageEvents(prevRef.current, state, Date.now());
    prevRef.current = state;
    if (added.length > 0) {
      setLog((old) => [...added].reverse().concat(old).slice(0, maxEntries));
    }
  }, [state, maxEntries]);

  return (
    <section
      aria-label="Stage events"
      className={`flex min-h-0 flex-col rounded-xl border ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
      }}
    >
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2">
        <span className="text-[12px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Stage events
        </span>
        <span className="text-[12px]" style={{ color: '#5f7d6e' }}>
          live
        </span>
      </header>
      {log.length === 0 ? (
        <p className="px-3.5 pb-3 text-[12px]" style={{ color: '#5f7d6e' }}>
          No stage events yet.
        </p>
      ) : (
        <ul className="scrollbar-thin min-h-0 flex-1 list-none overflow-y-auto px-1.5 pb-2">
          {log.map((entry, i) => (
            <li
              key={`${entry.id}:${entry.at}:${i}`}
              className="flex items-center gap-2 px-2 py-1 text-[12px]"
            >
              <i aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOUR[entry.kind] }} />
              <time className="shrink-0 tabular-nums" style={{ color: '#5f7d6e' }}>
                {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </time>
              <span className="truncate" style={{ color: '#e8f7ee' }}>
                {entry.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
