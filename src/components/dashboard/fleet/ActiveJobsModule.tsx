'use client';

/**
 * SAM — Active jobs module (Modules A, T9).
 *
 * One row per `FloorWorker` currently queued or running, read straight off
 * the `FloorState` a parent already polls (T1/T5) — no fetch of its own, no
 * recomputation of status. Clicking a row tells the parent which job (and,
 * when the job belongs to a General rather than SAM, which General) was
 * picked; wiring that into the zoom/detail view is T11's job, not this one.
 */

import type { FloorState, FloorWorker, FloorWorkerStatus, GeneralId } from '@/types/floor';

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

export interface ActiveJobEntry {
  general: GeneralId | 'sam';
  worker: FloorWorker;
}

export interface ActiveJobsModuleProps {
  /** The floor's current state, from a parent that already polls `/api/fleet/floor` (T5/T11). Null before the first load. */
  state: FloorState | null;
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
  onSelectGeneral?: (id: GeneralId) => void;
  className?: string;
}

/** Every worker still queued or running, General first then SAM, longest-running first. */
export function activeJobEntries(state: FloorState | null): ActiveJobEntry[] {
  if (!state) return [];
  const entries: ActiveJobEntry[] = [];
  for (const id of GENERAL_IDS) {
    for (const worker of state.generals[id].workers) {
      if (worker.status === 'queued' || worker.status === 'running') entries.push({ general: id, worker });
    }
  }
  for (const worker of state.samWorkers) {
    if (worker.status === 'queued' || worker.status === 'running') entries.push({ general: 'sam', worker });
  }
  return entries.sort((a, b) => b.worker.elapsedMs - a.worker.elapsedMs);
}

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

function generalLabel(general: GeneralId | 'sam'): string {
  return general === 'sam' ? 'SAM' : GENERAL_LABELS[general];
}

export default function ActiveJobsModule({
  state,
  selectedJobId = null,
  onSelectJob,
  onSelectGeneral,
  className,
}: ActiveJobsModuleProps) {
  const entries = activeJobEntries(state);

  const selectRow = (entry: ActiveJobEntry) => {
    onSelectJob?.(entry.worker.jobId);
    if (entry.general !== 'sam') onSelectGeneral?.(entry.general);
  };

  return (
    <section
      aria-label="Active jobs"
      className={`flex min-h-0 flex-col rounded-xl border ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
      }}
    >
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2">
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Active jobs
        </span>
        <span className="text-[11px]" style={{ color: '#5f7d6e' }}>
          {entries.length} live
        </span>
      </header>
      {entries.length === 0 ? (
        <p className="px-3.5 pb-3 text-[11px]" style={{ color: '#5f7d6e' }}>
          No jobs queued or running.
        </p>
      ) : (
        <ul className="scrollbar-thin min-h-0 flex-1 list-none overflow-y-auto px-1.5 pb-2">
          {entries.map((entry) => {
            const selected = entry.worker.jobId === selectedJobId;
            return (
              <li key={entry.worker.jobId}>
                <button
                  type="button"
                  onClick={() => selectRow(entry)}
                  aria-pressed={selected}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                  style={{
                    background: selected ? 'rgba(61,255,90,.09)' : 'transparent',
                    boxShadow: selected ? 'inset 0 0 0 1px rgba(61,255,90,.34)' : undefined,
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold" style={{ color: '#e8f7ee' }}>
                      {generalLabel(entry.general)}
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold"
                      style={{ color: STATUS_COLOUR[entry.worker.status] }}
                    >
                      <i
                        aria-hidden
                        className="inline-block size-1.5 rounded-full"
                        style={{ background: STATUS_COLOUR[entry.worker.status] }}
                      />
                      {statusLabel(entry.worker.status)}
                    </span>
                  </span>
                  <span className="truncate text-[11px]" style={{ color: '#5f7d6e' }}>
                    {entry.worker.jobId}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
