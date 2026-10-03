'use client';

/**
 * SAM — Fleet status module (Modules B, T10).
 *
 * One row per General (plus SAM), read straight off the `FloorState` a
 * parent already polls (T1/T5) — no fetch of its own, no recomputation of
 * status (same pattern as `ActiveJobsModule`/`JobDetailModule`, T9).
 *
 * A General's busy/idle here is `!state.generals[id].idle` verbatim — the
 * exact field (falling back to the reader's own `idle: true` default for a
 * missing entry) that `floorRender.ts`'s `buildScene` reads for the bust's
 * brightness (`const idle = !!entry.idle`, see `floorRender.ts` around line
 * 555-557, fed by T8's `bustLevel`). This row and T7/T8's bust brightness
 * read the same boolean off the same object, so the two can never disagree
 * (Must 10, ticket note: "derived the same way T7/T8 derive bust
 * brightness").
 *
 * SAM has no `idle` field of its own in `FloorState` (it is the
 * orchestrator, not a General with a platform) — its row is busy whenever
 * `samWorkers` holds a job that is queued or running, the same liveness
 * test `ActiveJobsModule.activeJobEntries` and `floorRender.ts`'s `isLive`
 * use.
 */

import type { FloorState, GeneralId } from '@/types/floor';

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

/** Matches `floorRender.ts`'s own `GENERALS` role text — restated here rather than imported so this module stays decoupled from the canvas renderer, same choice `ActiveJobsModule`/`JobDetailModule` made for their label maps. */
const GENERAL_ROLES: Record<GeneralId, string> = {
  hermes: 'Growth',
  hephaestus: 'Delivery',
  calliope: 'Marketing',
  cerberus: 'Security',
  prometheus: 'R&D',
};

export interface FleetStatusRow {
  id: GeneralId | 'sam';
  name: string;
  sub: string;
  busy: boolean;
  /** Jobs currently queued or running under this row (0 for an idle General; SAM counts `samWorkers`). */
  liveCount: number;
}

const isLive = (status: { status: string }) => status.status === 'queued' || status.status === 'running';

/**
 * One row per General plus SAM, SAM first (mockup order). Pure and
 * side-effect free so it can be tested without mounting anything.
 */
export function fleetStatusRows(state: FloorState | null): FleetStatusRow[] {
  const samLive = state ? state.samWorkers.filter(isLive).length : 0;
  const rows: FleetStatusRow[] = [
    { id: 'sam', name: 'SAM', sub: 'Orchestrator', busy: samLive > 0, liveCount: samLive },
  ];
  for (const id of GENERAL_IDS) {
    const entry = state?.generals[id] ?? { idle: true, workers: [] };
    rows.push({
      id,
      name: GENERAL_LABELS[id],
      sub: GENERAL_ROLES[id],
      busy: !entry.idle,
      liveCount: entry.workers.filter(isLive).length,
    });
  }
  return rows;
}

export interface FleetStatusModuleProps {
  /** The floor's current state, from a parent that already polls `/api/fleet/floor` (T5/T11). Null before the first load. */
  state: FloorState | null;
  selectedGeneral?: GeneralId | null;
  onSelectGeneral?: (id: GeneralId) => void;
  className?: string;
}

export default function FleetStatusModule({
  state,
  selectedGeneral = null,
  onSelectGeneral,
  className,
}: FleetStatusModuleProps) {
  const rows = fleetStatusRows(state);
  const busyCount = rows.filter((r) => r.id !== 'sam' && r.busy).length;
  const idleCount = GENERAL_IDS.length - busyCount;

  return (
    <section
      aria-label="Fleet status"
      className={`flex min-h-0 flex-col rounded-xl border ${className ?? ''}`}
      style={{
        background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))',
        borderColor: 'rgba(61,255,90,.12)',
      }}
    >
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2">
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase" style={{ color: '#98b6a6' }}>
          Fleet status
        </span>
        <span className="text-[11px]" style={{ color: '#5f7d6e' }}>
          {busyCount} busy · {idleCount} idle
        </span>
      </header>
      <ul className="scrollbar-thin min-h-0 flex-1 list-none overflow-y-auto px-1.5 pb-2">
        {rows.map((row) => {
          const clickable = row.id !== 'sam';
          const selected = clickable && row.id === selectedGeneral;
          const dotColour = row.busy ? '#3dff5a' : '#5f7d6e';
          const content = (
            <>
              <span className="flex items-center gap-1.5 truncate">
                <i aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: dotColour }} />
                <span className="truncate text-[12.5px] font-semibold" style={{ color: '#e8f7ee' }}>
                  {row.name}
                </span>
                <small className="truncate text-[11px]" style={{ color: '#5f7d6e' }}>
                  {row.sub}
                </small>
              </span>
              <span
                className="shrink-0 text-[11px] font-semibold"
                style={{ color: row.busy ? '#3dff5a' : '#5f7d6e' }}
              >
                {row.busy ? `Working · ${row.liveCount}` : 'Idle'}
              </span>
            </>
          );
          return (
            <li key={row.id}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelectGeneral?.(row.id as GeneralId)}
                  aria-pressed={selected}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
                  style={{
                    background: selected ? 'rgba(61,255,90,.09)' : 'transparent',
                    boxShadow: selected ? 'inset 0 0 0 1px rgba(61,255,90,.34)' : undefined,
                  }}
                >
                  {content}
                </button>
              ) : (
                <div className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
