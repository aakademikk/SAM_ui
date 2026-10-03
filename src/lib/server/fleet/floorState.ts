/**
 * SAM — Floor state: a live job-store reader.
 *
 * This is the one function every renderer and module on the fleet floor
 * reads from — the same role as the approved mockup's `stateAt(job, t)`
 * (`/home/col/Atwood_demos/sam-ui-concepts/src/engine.js:83`), whose own
 * note reads: "When real stage events arrive, `stateAt` is replaced by the
 * event stream and nothing else needs to change." That day has come: this
 * reads the real `events.jsonl` stream when one exists.
 *
 * The job store has two meta.json shapes today (see
 * `implementation/visual-upgrade-tickets.md`, "Read before any ticket"):
 * `sam-job`'s own and `JobManager.writeMeta`'s (`JobRecord`,
 * `src/types/jobs.ts`). Neither carries a `general`, `stages` or `events`
 * field on jobs written before Must 16/16a shipped, and `/api/fleet/dispatch`
 * jobs never will (it bypasses `sam-job` entirely) — so every field below is
 * read as optional, and a job with neither a `general` field nor a matching
 * `fleet:<persona>` command is grouped under SAM, never invented a stage
 * (Must 17).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { costFleetJob } from '@/lib/server/fleet/jobCosts';

import type { FloorState, FloorStage, FloorWorker, GeneralId } from '@/types/floor';

// Resolved at module load, not inside the function — so a test that sets
// HOME to a temp dir before dynamically importing this module gets its own
// job store, the same seam `src/lib/server/jobs/manager.ts` and its tests
// use.
const JOBS_ROOT = path.join(os.homedir(), '.sam', 'jobs');

// "A few hundred most-recent", same spirit as the spend scan's MAX_SCAN
// (`src/app/api/fleet/spend/route.ts`), but sorted by directory mtime first
// so the cap can't silently drop the newest jobs under a large store.
const MAX_SCAN = 300;

// A dispatch flare fires "at no other time" (Must 9) — roughly the last few
// seconds of a `dispatched` event, not a guess at whether the job is still
// queued.
const DISPATCH_FLARE_WINDOW_MS = 10_000;

const GENERAL_IDS: readonly GeneralId[] = [
  'hermes',
  'hephaestus',
  'calliope',
  'cerberus',
  'prometheus',
];

// Same regex as `src/app/api/fleet/jobs/route.ts` and
// `src/app/api/fleet/spend/route.ts`: `fleet:<persona> (<model>) — <brief>`,
// the label `/api/fleet/dispatch` sets today. This is the legacy fallback
// (Must 7's honesty for jobs with no `general` field yet) — read only, never
// changed here.
const FLEET_COMMAND_RE = /^fleet:([a-z0-9_-]+)(?:\s+\(([^)]+)\))?/;

/** A stored job's meta.json — both shapes, plus the Must 16/16a additions. */
interface StoredMeta {
  command?: string;
  status?: string;
  exitCode?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  general?: string;
  /** Written by `sam-dispatch` (Must 16a) — an array, or a `--stages` comma string. */
  stages?: unknown;
  origin?: string;
}

/** One line of a job's `events.jsonl` (Must 16b–16d). */
interface EventLine {
  type?: string;
  stage?: string;
  exitCode?: number;
  at?: string;
  /** Carried on the `dispatched` event only — the planned stage list. */
  stages?: unknown;
}

interface JobResult {
  general: GeneralId | 'sam';
  worker: FloorWorker;
  reachedDoneToday: boolean;
  dispatchFlare?: { jobId: string; at: string };
}

/** Reads `~/.sam/jobs/*\/meta.json` and builds the floor's whole picture. */
export async function readFloorState(): Promise<FloorState> {
  const generals = {} as FloorState['generals'];
  for (const general of GENERAL_IDS) generals[general] = { idle: true, workers: [] };

  const towers = {} as Record<GeneralId, number>;
  for (const general of GENERAL_IDS) towers[general] = 0;

  const samWorkers: FloorWorker[] = [];
  const dispatchFlares: { jobId: string; at: string }[] = [];

  const ids = await listRecentJobIds();

  for (const id of ids) {
    const result = await readJob(id);
    if (!result) continue;

    const { general, worker, reachedDoneToday, dispatchFlare } = result;

    // A finished job has already "returned to SAM" (Must 11): it no longer
    // sits on the floor as a worker figure, it only ever contributes a tower
    // slab (Generals) or simply drops off (SAM has no tower).
    if (worker.status !== 'done') {
      if (general === 'sam') samWorkers.push(worker);
      else generals[general].workers.push(worker);
    }

    if (general !== 'sam' && reachedDoneToday) towers[general] += 1;
    if (dispatchFlare) dispatchFlares.push(dispatchFlare);
  }

  // Idle is computed after every job is placed, not incrementally — order of
  // the directory scan must never affect the result (Must 10).
  for (const general of GENERAL_IDS) {
    generals[general].idle = !generals[general].workers.some((w) => w.status === 'running');
  }

  return { generals, samWorkers, towers, dispatchFlares };
}

/** Job directory names, most-recently-touched first, capped at MAX_SCAN. */
async function listRecentJobIds(): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fsp.readdir(JOBS_ROOT);
  } catch {
    return [];
  }

  const stated = await Promise.all(
    names.map(async (name) => {
      try {
        const stat = await fsp.stat(path.join(JOBS_ROOT, name));
        return { name, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  return stated
    .filter((entry): entry is { name: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_SCAN)
    .map((entry) => entry.name);
}

async function readJob(id: string): Promise<JobResult | null> {
  const dir = path.join(JOBS_ROOT, id);

  let metaRaw: string;
  try {
    metaRaw = await fsp.readFile(path.join(dir, 'meta.json'), 'utf-8');
  } catch {
    return null;
  }

  let meta: StoredMeta;
  try {
    meta = JSON.parse(metaRaw) as StoredMeta;
  } catch {
    return null;
  }

  const general = resolveGeneral(meta);
  const dispatchedModel = modelFromCommand(meta.command);
  const events = await readEvents(dir);
  const stagesPlanned = resolveStagesPlanned(meta, events);

  let status: FloorWorker['status'];
  let startedAt: string | null = meta.startedAt ?? null;
  let endedAt: string | null = meta.endedAt ?? null;
  let exitCode: number | null = meta.exitCode ?? null;
  let stages: FloorStage[] | null = null;
  let dispatchedEvent: EventLine | undefined;

  if (events) {
    dispatchedEvent = events.find((e) => e.type === 'dispatched');
    const started = events.find((e) => e.type === 'started');
    // Last 'ended' line wins — there should only ever be one, but a stray
    // duplicate must not be read as "still running".
    const ended = [...events].reverse().find((e) => e.type === 'ended');

    if (started?.at) startedAt = started.at;

    if (ended) {
      if (ended.at) endedAt = ended.at;
      if (typeof ended.exitCode === 'number') exitCode = ended.exitCode;
      status = exitCode === 0 ? 'done' : 'failed';
    } else if (started) {
      status = 'running';
    } else if (dispatchedEvent) {
      status = 'queued';
    } else {
      status = synthesizeStatus(meta);
    }

    // Stage states only ever come from real events (Must 8, 17) — 'todo' for
    // a planned stage with no event yet is a true report ("hasn't started"),
    // never a guess at when it will.
    if (stagesPlanned) {
      stages = stagesPlanned.map((name) => {
        const done = events.some((e) => e.type === 'stage-done' && e.stage === name);
        if (done) return { name, state: 'done' as const };
        const now = events.some((e) => e.type === 'stage-start' && e.stage === name);
        return { name, state: now ? ('now' as const) : ('todo' as const) };
      });
    }
  } else {
    status = synthesizeStatus(meta);
  }

  const elapsedMs = computeElapsedMs(startedAt, endedAt);
  const costed = await costFleetJob(id, dispatchedModel);

  const worker: FloorWorker = {
    jobId: id,
    general,
    status,
    origin: resolveOrigin(meta),
    stages,
    stagesPlanned,
    elapsedMs,
    costUsd: costed.costUsd,
    startedAt,
    endedAt,
  };

  const reachedDoneToday =
    general !== 'sam' &&
    status === 'done' &&
    endedAt !== null &&
    isValidDate(endedAt) &&
    localDateKey(new Date(endedAt)) === localDateKey(new Date());

  const dispatchFlare =
    dispatchedEvent?.at && isRecent(dispatchedEvent.at)
      ? { jobId: id, at: dispatchedEvent.at }
      : undefined;

  return { general, worker, reachedDoneToday, dispatchFlare };
}

/**
 * General from, in order: (a) a `general` field (Must 16a), (b) the legacy
 * `fleet:<persona>` command convention, (c) none — grouped under SAM. Never
 * trusts an unknown name in either field.
 */
function resolveGeneral(meta: StoredMeta): GeneralId | 'sam' {
  if (isGeneralId(meta.general)) return meta.general;

  if (typeof meta.command === 'string') {
    const match = meta.command.match(FLEET_COMMAND_RE);
    if (match && isGeneralId(match[1])) return match[1];
  }

  return 'sam';
}

function isGeneralId(value: unknown): value is GeneralId {
  return typeof value === 'string' && (GENERAL_IDS as readonly string[]).includes(value);
}

function modelFromCommand(command: string | undefined): string {
  if (!command) return '';
  const match = command.match(FLEET_COMMAND_RE);
  return match?.[2] ?? '';
}

function resolveOrigin(meta: StoredMeta): FloorWorker['origin'] {
  if (meta.origin === 'chat' || meta.origin === 'schedule' || meta.origin === 'manual') {
    return meta.origin;
  }
  return 'unknown';
}

/**
 * The planned stage list from `meta.json`'s own `stages` field (T2/T3 may
 * write an array, or a comma string from `--stages`) and/or the `dispatched`
 * event's `stages` array — whichever is found first.
 */
function resolveStagesPlanned(meta: StoredMeta, events: EventLine[] | null): string[] | null {
  const fromMeta = parseStagesField(meta.stages);
  if (fromMeta) return fromMeta;

  const dispatched = events?.find((e) => e.type === 'dispatched');
  const fromEvent = parseStagesField(dispatched?.stages);
  return fromEvent;
}

function parseStagesField(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const cleaned = value.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof value === 'string') {
    const cleaned = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return cleaned.length > 0 ? cleaned : null;
  }
  return null;
}

/** `events.jsonl` beside `meta.json`, one JSON object per line. Null if absent. */
async function readEvents(dir: string): Promise<EventLine[] | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(path.join(dir, 'events.jsonl'), 'utf-8');
  } catch {
    return null;
  }

  const events: EventLine[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as EventLine);
    } catch {
      // A malformed line must not sink the whole job's read.
    }
  }
  return events;
}

/**
 * No `events.jsonl`: synthesise only queued/running/done/failed from
 * `meta.json`'s own status and timestamps (Must 17) — `stages` stays null,
 * set by the caller.
 */
function synthesizeStatus(meta: StoredMeta): FloorWorker['status'] {
  switch (meta.status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'exited':
      return meta.exitCode === 0 ? 'done' : 'failed';
    case 'killed':
    case 'failed':
    case 'stopped':
      return 'failed';
    default:
      if (!meta.startedAt) return 'queued';
      if (!meta.endedAt) return 'running';
      return meta.exitCode === 0 ? 'done' : 'failed';
  }
}

function computeElapsedMs(startedAt: string | null, endedAt: string | null): number {
  if (!startedAt || !isValidDate(startedAt)) return 0;
  const start = Date.parse(startedAt);
  const end = endedAt && isValidDate(endedAt) ? Date.parse(endedAt) : Date.now();
  return Math.max(0, end - start);
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isRecent(at: string): boolean {
  if (!isValidDate(at)) return false;
  const age = Date.now() - Date.parse(at);
  // Small negative tolerance for clock skew between writer and reader.
  return age <= DISPATCH_FLARE_WINDOW_MS && age >= -1_000;
}
