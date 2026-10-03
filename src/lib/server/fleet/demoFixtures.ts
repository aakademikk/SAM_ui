/**
 * SAM — Demo-mode fixtures (T20, T20b).
 *
 * Everything in this file is invented, original demo data (Must 18, 19):
 * no real client name, file path, chat text or live cost from Colin's
 * system. `demoFloorStateAt(t)`/`demoScheduleAt(t)` are the demo-mode
 * analogue of `readFloorState`/`readScheduledJobs` — a pure function of a
 * millisecond clock `t`, so a frozen `t` always renders the same demo
 * state and polling with the real clock replays the loop (Must 18). The
 * three demo jobs (Open House/Hephaestus, the CVE audit/Cerberus, Bait the
 * Hook/Hermes) and the demo schedule follow the shape of the approved
 * mockup's own `SCENARIOS`/`JOBS` (`src/engine.js`, `src/e-scene.js`,
 * design source, read-only) without reusing any of Colin's real timer or
 * client names.
 *
 * `demoFleetSpend`/`demoFleetPersonaJobs` (T20b) are the demo-mode
 * analogue of `/api/fleet/spend` and `/api/fleet/jobs`'s own live scans —
 * neither reads the live job store.
 */

import type {
  FloorStage,
  FloorState,
  FloorWorker,
  GeneralId,
  ScheduleCadence,
  ScheduleKind,
  ScheduledJob,
} from '@/types/floor';
import type { FleetPersonaJob, FleetSpend } from '@/types/fleet';

const GENERAL_IDS: readonly GeneralId[] = [
  'hermes',
  'hephaestus',
  'calliope',
  'cerberus',
  'prometheus',
];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// ---------------------------------------------------------------------------
// The three demo jobs (Must 18): one segment of a 90 s loop each, cycling
// hephaestus -> cerberus -> hermes -> repeat.
// ---------------------------------------------------------------------------

export const DEMO_LOOP_MS = 90_000;
const SEGMENT_MS = DEMO_LOOP_MS / 3;
const QUEUED_MS = 2_000;
/** The job settles (shows done, drops a tower slab) 4 s before the next job's queued phase starts. */
const RUN_END_MS = SEGMENT_MS - 4_000;

interface DemoJobSpec {
  slug: string;
  general: GeneralId;
  brief: string;
  model: string;
  stages: readonly string[];
  origin: FloorWorker['origin'];
  totalCostUsd: number;
}

const DEMO_JOBS: readonly DemoJobSpec[] = [
  {
    slug: 'open-house',
    general: 'hephaestus',
    brief: 'Build a three-page prototype site with a quote form for a demo lead.',
    model: 'sonnet',
    stages: ['Grill', 'Spec', 'Tickets', 'Implement', 'Code review'],
    origin: 'chat',
    totalCostUsd: 1.85,
  },
  {
    slug: 'cve-audit',
    general: 'cerberus',
    brief: 'Run the weekly dependency CVE audit across the demo client repos.',
    model: 'opus',
    stages: ['Scan', 'Triage', 'Report'],
    origin: 'schedule',
    totalCostUsd: 0.95,
  },
  {
    slug: 'bait-hook',
    general: 'hermes',
    brief: 'Write ten WhatsApp openers for a demo lead list, split A/B.',
    model: 'haiku',
    stages: ['Draft', 'Review'],
    origin: 'manual',
    totalCostUsd: 0.2,
  },
];

interface ActiveDemoJob {
  spec: DemoJobSpec;
  jobId: string;
  segmentStartMs: number;
  withinSegmentMs: number;
}

/** Which of the three demo jobs is in its segment at clock `t`, and how far into it. */
function activeDemoJob(t: number): ActiveDemoJob {
  const loopIndex = Math.floor(t / DEMO_LOOP_MS);
  const cyclePos = mod(t, DEMO_LOOP_MS);
  const segmentIndex = Math.floor(cyclePos / SEGMENT_MS);
  const withinSegmentMs = cyclePos - segmentIndex * SEGMENT_MS;
  const spec = DEMO_JOBS[segmentIndex];
  return {
    spec,
    jobId: `demo-${spec.slug}-${loopIndex}`,
    segmentStartMs: t - withinSegmentMs,
    withinSegmentMs,
  };
}

interface DemoWorkerResult {
  worker: FloorWorker;
  dispatchFlare?: { jobId: string; at: string };
}

/** The active demo job's worker at this instant: queued, running (stages lighting in order) or done. */
function demoWorkerFor(active: ActiveDemoJob): DemoWorkerResult {
  const { spec, jobId, segmentStartMs, withinSegmentMs } = active;
  const dispatchedAt = segmentStartMs + QUEUED_MS;

  if (withinSegmentMs < QUEUED_MS) {
    return {
      worker: {
        jobId,
        general: spec.general,
        status: 'queued',
        origin: spec.origin,
        stages: spec.stages.map((name) => ({ name, state: 'todo' as const })),
        stagesPlanned: [...spec.stages],
        elapsedMs: 0,
        costUsd: 0,
        startedAt: null,
        endedAt: null,
      },
    };
  }

  // The dispatch flare (Must 9) fires once, for a few seconds, right as the
  // job leaves 'queued' — same window `recordFlares` (busts.ts) keys off of.
  const dispatchFlare =
    withinSegmentMs < QUEUED_MS + 3_000 ? { jobId, at: new Date(dispatchedAt).toISOString() } : undefined;

  if (withinSegmentMs >= RUN_END_MS) {
    return {
      worker: {
        jobId,
        general: spec.general,
        status: 'done',
        origin: spec.origin,
        stages: spec.stages.map((name) => ({ name, state: 'done' as const })),
        stagesPlanned: [...spec.stages],
        elapsedMs: RUN_END_MS - QUEUED_MS,
        costUsd: spec.totalCostUsd,
        startedAt: new Date(dispatchedAt).toISOString(),
        endedAt: new Date(segmentStartMs + RUN_END_MS).toISOString(),
      },
      dispatchFlare,
    };
  }

  const runMs = withinSegmentMs - QUEUED_MS;
  const runSpan = RUN_END_MS - QUEUED_MS;
  const perStage = runSpan / spec.stages.length;
  const doneCount = Math.min(spec.stages.length, Math.floor(runMs / perStage));
  const stages: FloorStage[] = spec.stages.map((name, i) => ({
    name,
    state: i < doneCount ? 'done' : i === doneCount ? 'now' : 'todo',
  }));
  const progress = Math.min(1, runMs / runSpan);

  return {
    worker: {
      jobId,
      general: spec.general,
      status: 'running',
      origin: spec.origin,
      stages,
      stagesPlanned: [...spec.stages],
      elapsedMs: runMs,
      costUsd: Math.round(spec.totalCostUsd * progress * 100) / 100,
      startedAt: new Date(dispatchedAt).toISOString(),
      endedAt: null,
    },
    dispatchFlare,
  };
}

const BASELINE_TOWERS: Record<GeneralId, number> = {
  hermes: 2,
  hephaestus: 1,
  calliope: 0,
  cerberus: 3,
  prometheus: 0,
};

/** Flavour only — not tied to the loop — honouring Must 17's honesty: no invented stages for a job with none. */
const BACKGROUND_JOB_ID = 'demo-benchmark';
const QUEUED_DEMO_JOB_ID = 'demo-proposal-deck';

/** The demo-mode analogue of `readFloorState` (T1): a pure function of the clock, replaying on a loop (Must 18). */
export function demoFloorStateAt(t: number): FloorState {
  const generals = {} as FloorState['generals'];
  for (const g of GENERAL_IDS) generals[g] = { idle: true, workers: [] };
  const towers = { ...BASELINE_TOWERS };
  const dispatchFlares: { jobId: string; at: string }[] = [];

  const active = activeDemoJob(t);
  const { worker, dispatchFlare } = demoWorkerFor(active);
  if (worker.status === 'done') {
    towers[active.spec.general] += 1;
  } else {
    generals[active.spec.general].workers.push(worker);
  }
  if (dispatchFlare) dispatchFlares.push(dispatchFlare);

  generals.prometheus.workers.push({
    jobId: BACKGROUND_JOB_ID,
    general: 'prometheus',
    status: 'running',
    origin: 'manual',
    stages: null,
    stagesPlanned: null,
    elapsedMs: 41 * 60_000 + mod(t, 10 * 60_000),
    costUsd: 2.31,
    startedAt: new Date(t - (41 * 60_000 + mod(t, 10 * 60_000))).toISOString(),
    endedAt: null,
  });
  generals.calliope.workers.push({
    jobId: QUEUED_DEMO_JOB_ID,
    general: 'calliope',
    status: 'queued',
    origin: 'manual',
    stages: null,
    stagesPlanned: null,
    elapsedMs: 0,
    costUsd: 0,
    startedAt: null,
    endedAt: null,
  });

  for (const g of GENERAL_IDS) {
    generals[g].idle = !generals[g].workers.some((w) => w.status === 'running');
  }

  return { generals, samWorkers: [], towers, dispatchFlares };
}

// ---------------------------------------------------------------------------
// The demo schedule (Must 18, 23): a generic, invented mix of timers and
// cron entries exercising every ring-mark shape (bead, line, diamond).
// ---------------------------------------------------------------------------

interface DemoScheduleSpec {
  id: string;
  kind: ScheduleKind;
  name: string;
  schedulePlain: string;
  cadence: ScheduleCadence;
  periodMs: number;
  lastFailed?: boolean;
  launchesFleetJob?: boolean;
}

const DEMO_SCHEDULE_SPECS: readonly DemoScheduleSpec[] = [
  // frequent -> a bead on the inner track
  { id: 'demo-keep-warm.timer', kind: 'timer', name: 'Keep-warm ping', schedulePlain: 'Every 15 min', cadence: 'frequent', periodMs: 15 * 60_000 },
  { id: 'demo-vault-commit.timer', kind: 'timer', name: 'Vault commit', schedulePlain: 'Every 30 min', cadence: 'frequent', periodMs: 30 * 60_000 },
  // hours/daily -> a line tick on the outer dial
  { id: 'demo-quota-log.timer', kind: 'timer', name: 'Quota log', schedulePlain: 'Hourly', cadence: 'hours', periodMs: 60 * 60_000 },
  { id: 'demo-delegation-check.timer', kind: 'timer', name: 'Delegation check', schedulePlain: 'Every 4 hours', cadence: 'hours', periodMs: 4 * 60 * 60_000 },
  { id: 'demo-nightly-backup.timer', kind: 'timer', name: 'Nightly backup', schedulePlain: 'Daily at 22:30', cadence: 'daily', periodMs: 24 * 60 * 60_000 },
  { id: 'demo-lead-finder.timer', kind: 'timer', name: 'Lead finder sweep', schedulePlain: 'Daily at 06:15', cadence: 'daily', periodMs: 24 * 60 * 60_000, lastFailed: true },
  { id: 'demo-quota-archive-cron', kind: 'cron', name: 'Quota archive', schedulePlain: 'Daily at 00:30', cadence: 'daily', periodMs: 24 * 60 * 60_000 },
  { id: 'demo-log-sweep-cron', kind: 'cron', name: 'Log sweep', schedulePlain: 'Every 6 hours', cadence: 'hours', periodMs: 6 * 60 * 60_000 },
  // weekly/weekday -> a diamond
  { id: 'demo-cve-scan.timer', kind: 'timer', name: 'Dependency CVE scan', schedulePlain: 'Weekly, Wed 11:20', cadence: 'weekly', periodMs: 7 * 24 * 60 * 60_000, launchesFleetJob: true },
  { id: 'demo-outreach-send.timer', kind: 'timer', name: 'Outreach send', schedulePlain: 'Weekdays at 16:30', cadence: 'weekday', periodMs: 24 * 60 * 60_000 },
  { id: 'demo-news-digest.timer', kind: 'timer', name: 'News digest', schedulePlain: 'Weekly, Mon 08:30', cadence: 'weekly', periodMs: 7 * 24 * 60 * 60_000 },
];

/** The demo-mode analogue of `readScheduledJobs` (T16): a pure function of the clock. */
export function demoScheduleAt(t: number): ScheduledJob[] {
  return DEMO_SCHEDULE_SPECS.map((spec) => {
    const lastRunMs = t - mod(t, spec.periodMs);
    const nextRunMs = lastRunMs + spec.periodMs;
    const nextRun = new Date(nextRunMs).toISOString();

    if (spec.kind === 'cron') {
      return {
        id: spec.id,
        kind: 'cron',
        name: spec.name,
        schedulePlain: spec.schedulePlain,
        cadence: spec.cadence,
        lastRun: 'not recorded',
        lastResult: 'not recorded',
        nextRun,
        launchesFleetJob: spec.launchesFleetJob ?? false,
      };
    }

    return {
      id: spec.id,
      kind: 'timer',
      name: spec.name,
      schedulePlain: spec.schedulePlain,
      cadence: spec.cadence,
      lastRun: new Date(lastRunMs).toISOString(),
      lastResult: spec.lastFailed ? 'failed' : 'ok',
      nextRun,
      launchesFleetJob: spec.launchesFleetJob ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Demo spend and job history (T20b): the demo-mode analogue of
// `/api/fleet/spend` and `/api/fleet/jobs`'s own live scans. Never reads the
// live job store.
// ---------------------------------------------------------------------------

const DEMO_PERSONA_SPEND: Record<GeneralId, { jobs: number; costUsd: number }> = {
  hermes: { jobs: 6, costUsd: 1.94 },
  hephaestus: { jobs: 4, costUsd: 4.37 },
  calliope: { jobs: 5, costUsd: 2.21 },
  cerberus: { jobs: 3, costUsd: 1.48 },
  prometheus: { jobs: 2, costUsd: 2.61 },
};

/** The demo-mode analogue of `/api/fleet/spend`'s scan. */
export function demoFleetSpend(): FleetSpend {
  const personas: FleetSpend['personas'] = {};
  let totalCostUsd = 0;
  let scannedJobs = 0;
  for (const g of GENERAL_IDS) {
    const entry = DEMO_PERSONA_SPEND[g];
    personas[g] = { jobs: entry.jobs, costUsd: entry.costUsd };
    totalCostUsd += entry.costUsd;
    scannedJobs += entry.jobs;
  }
  return { personas, totalCostUsd: Math.round(totalCostUsd * 100) / 100, scannedJobs };
}

interface DemoHistoryEntry {
  brief: string;
  model: string;
  costUsd: number;
  durationMs: number;
  daysAgo: number;
  failed?: boolean;
}

const DEMO_PERSONA_HISTORY: Record<GeneralId, readonly DemoHistoryEntry[]> = {
  hephaestus: [
    { brief: 'Lighthouse pass for a demo plumber site.', model: 'sonnet', costUsd: 0.51, durationMs: 302_000, daysAgo: 0 },
    { brief: 'Prototype landing page for a demo roofer lead.', model: 'sonnet', costUsd: 0.38, durationMs: 287_000, daysAgo: 1, failed: true },
  ],
  cerberus: [
    { brief: 'Security headers check across four demo client sites.', model: 'haiku', costUsd: 0.09, durationMs: 65_000, daysAgo: 0 },
  ],
  hermes: [
    { brief: 'Inbox triage: overnight replies.', model: 'haiku', costUsd: 0.06, durationMs: 48_000, daysAgo: 0 },
  ],
  calliope: [
    { brief: 'Ad set for a demo app launch, three variants.', model: 'sonnet', costUsd: 0.42, durationMs: 252_000, daysAgo: 0 },
  ],
  prometheus: [
    { brief: 'Benchmark sonnet vs haiku on ticket builds.', model: 'opus', costUsd: 2.31, durationMs: 2_472_000, daysAgo: 0 },
  ],
};

/**
 * The demo-mode analogue of `/api/fleet/jobs?persona=<persona>`'s scan: the
 * currently active demo job for this persona (if any, matching
 * `demoFloorStateAt`'s cycle so Job detail's cross-reference resolves),
 * followed by a short invented history.
 */
export function demoFleetPersonaJobs(persona: GeneralId, t: number): FleetPersonaJob[] {
  const jobs: FleetPersonaJob[] = [];

  const active = activeDemoJob(t);
  if (active.spec.general === persona) {
    const { worker } = demoWorkerFor(active);
    // demoWorkerFor only ever reports 'queued' | 'running' | 'done' — mapped onto JobStatus explicitly, since the two
    // enums are not the same set (JobStatus has no 'verifying', FloorWorkerStatus has no 'exited').
    const status: FleetPersonaJob['status'] =
      worker.status === 'queued' ? 'queued' : worker.status === 'running' ? 'running' : 'exited';
    jobs.push({
      id: worker.jobId,
      command: `fleet:${persona} (${active.spec.model}) — ${active.spec.brief}`,
      status,
      exitCode: worker.status === 'done' ? 0 : null,
      createdAt: worker.startedAt ?? new Date(active.segmentStartMs).toISOString(),
      endedAt: worker.endedAt,
      model: active.spec.model,
      costUsd: worker.costUsd,
      costBasis: 'computed',
    });
  }

  const history = DEMO_PERSONA_HISTORY[persona] ?? [];
  history.forEach((h, i) => {
    const endedAtMs = t - h.daysAgo * 24 * 60 * 60_000;
    jobs.push({
      id: `demo-${persona}-hist-${i}`,
      command: `fleet:${persona} (${h.model}) — ${h.brief}`,
      status: 'exited',
      exitCode: h.failed ? 1 : 0,
      createdAt: new Date(endedAtMs - h.durationMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      model: h.model,
      costUsd: h.costUsd,
      costBasis: 'computed',
    });
  });

  return jobs;
}
