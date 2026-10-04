/**
 * SAM — Floor types.
 *
 * The fleet floor (the new Dashboard) draws SAM, the five Generals and their
 * workers from a single read of the job store. These types are that read's
 * output shape — the one contract every renderer and module (towers, ring,
 * job detail) builds from. See `floorState.ts` for the reader itself.
 */

export type GeneralId = 'hermes' | 'hephaestus' | 'calliope' | 'cerberus' | 'prometheus';

/**
 * 'verifying' is reserved for a transient UI state (proof travelling back to
 * SAM before a tower slab drops) — `readFloorState` never emits it itself,
 * it only ever reports the job store's own coarse states.
 */
export type FloorWorkerStatus = 'queued' | 'running' | 'verifying' | 'done' | 'failed';

export type FloorWorkerOrigin = 'chat' | 'schedule' | 'manual' | 'unknown';

export interface FloorStage {
  name: string;
  state: 'todo' | 'now' | 'done';
}

export interface FloorWorker {
  jobId: string;
  general: GeneralId | 'sam';
  status: FloorWorkerStatus;
  origin: FloorWorkerOrigin;
  /**
   * Null whenever the job's state can't be lit from real events (Must 17) —
   * never a guessed timeline, even if a planned list exists.
   */
  stages: FloorStage[] | null;
  /** The planned stage names in order, independent of whether any have lit. */
  stagesPlanned: string[] | null;
  elapsedMs: number;
  /** Null when no cost can be computed yet (e.g. no `result` event). */
  costUsd: number | null;
  startedAt: string | null;
  endedAt: string | null;
  /**
   * The most recent `action` event (Must 5) seen for this job, by file
   * order — never invented when no `action` event exists yet (Must 6: "no
   * action event yet" is omitted, never shown as unknown). Optional (not
   * just nullable) so the many existing `FloorWorker` fixtures/constructors
   * across the floor/phone/stage-events renderers — outside this ticket's
   * Files list — don't all need touching just to add this one field;
   * `floorState.ts`, the only producer this ticket owns, always sets it
   * explicitly to a value or `null`, never leaves it `undefined`.
   */
  lastAction?: { description: string; at: string } | null;
  /**
   * `meta.json`'s own `summary` field (sam-job's `--summary`), verbatim —
   * never invented, never derived from `command`. Optional (not just
   * nullable), same reasoning as `lastAction`: the many existing
   * `FloorWorker` fixtures/constructors outside this ticket's Files list
   * don't all need touching just to add this field; `floorState.ts` always
   * sets it explicitly to a value or `null`, never leaves it `undefined`.
   */
  summary?: string | null;
  /**
   * `meta.json`'s own `tier` field (ux-fixes T4's `sam-dispatch --tier`
   * pass-through), verbatim — never guessed from `command`'s `--model`
   * string. Same optional-not-just-nullable reasoning as `lastAction`.
   */
  tier?: string | null;
}

export interface FloorState {
  generals: Record<GeneralId, { idle: boolean; workers: FloorWorker[] }>;
  /** Jobs grouped under SAM: no General could be determined (Must 17). */
  samWorkers: FloorWorker[];
  /** One slab per job that reached `done` today (local day), per General. */
  towers: Record<GeneralId, number>;
  /** Jobs whose dispatch happened in roughly the last few seconds (Must 9). */
  dispatchFlares: { jobId: string; at: string }[];
}

/**
 * SAM — Scheduled jobs (the clock ring, T16/T17/T18).
 *
 * `readScheduledJobs` (`schedule.ts`) is the single reader for both
 * `systemctl --user list-timers` and `crontab -l`. These types are its
 * output shape — the contract the ring and the Schedule panel build from.
 */

export type ScheduleKind = 'timer' | 'cron';

/**
 * Mirrors the approved ring mockup's own `ESCHED.kind`
 * (`/home/col/Atwood_demos/sam-ui-concepts/src/e-scene.js`): 'frequent'
 * picks the inner bead track; 'weekday'/'weekly' the diamond mark; 'hours'
 * and 'daily' a line tick on the outer dial. 'other' is the honest fallback
 * for a schedule this reader can't classify (e.g. a specific day-of-month
 * or month cron/calendar expression) — never a guess.
 */
export type ScheduleCadence = 'frequent' | 'hours' | 'daily' | 'weekday' | 'weekly' | 'other';

/**
 * 'not recorded' is cron's own honest answer (Must 25): cron keeps no run
 * history, so a cron job's `lastResult` is always this sentinel, never a
 * guessed 'ok'/'failed'. A timer whose service has never completed a run
 * (no last trigger yet) reports the same sentinel, for the same reason.
 */
export type ScheduleLastResult = 'ok' | 'failed' | 'running' | 'not recorded';

export interface ScheduledJob {
  /** Stable across polls: the unit name for a timer, a hash of the cron line for cron. */
  id: string;
  kind: ScheduleKind;
  /** The unit name (`.timer` suffix stripped) or the cron line's command. */
  name: string;
  /** Plain words ("Daily at 06:00", "Every 15 min"), or the raw expression when unsure. */
  schedulePlain: string;
  cadence: ScheduleCadence;
  /** ISO timestamp of the last completed run; 'not recorded' for cron; null if a timer has never fired. */
  lastRun: string | null;
  lastResult: ScheduleLastResult;
  /** ISO timestamp of the next scheduled run, or null if it can't be computed (e.g. `@reboot`). */
  nextRun: string | null;
  /** Whether the job's command/`ExecStart` invokes `sam-dispatch` (Must 27's detection half). */
  launchesFleetJob: boolean;
}
