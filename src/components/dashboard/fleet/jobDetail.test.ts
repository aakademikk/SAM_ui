/**
 * SAM — jobDetail.test: `formatJobDetail`'s cost output must agree with
 * `costFleetJob`, the one costing function `/api/fleet/spend` and
 * `/api/fleet/jobs` both read (Must 15; spec check 9's cost-agreement half).
 *
 * The fixture job below is read through the real `readFloorState` (T1/T5),
 * the same reader the floor and this module's parent poll, so the
 * `FloorWorker` handed to `formatJobDetail` is exactly what production code
 * would produce — not a hand-built stand-in that could drift from it. Its
 * `costUsd` is `costFleetJob`'s own figure (see `floorState.ts`); this test
 * also calls `costFleetJob` directly on the same fixture and asserts the two
 * can never disagree.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { formatCost } from '../../../lib/costing.js';

// Route every ~/.sam path this test touches into a scratch HOME, set BEFORE
// the modules under test are imported — JOBS_ROOT in both floorState.ts and
// manager.ts is computed from os.homedir() at module load time, same seam as
// floorState.test.ts and readFrames.test.ts. The imports are dynamic so
// process.env.HOME is guaranteed to land first.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jobdetail-home-'));
process.env.HOME = tmpHome;

let readFloorState: typeof import('../../../lib/server/fleet/floorState.js').readFloorState;
let costFleetJob: typeof import('../../../lib/server/fleet/jobCosts.js').costFleetJob;
let formatJobDetail: typeof import('./JobDetailModule.js').formatJobDetail;
let formatElapsed: typeof import('./JobDetailModule.js').formatElapsed;
let formatAge: typeof import('./JobDetailModule.js').formatAge;
let briefFromCommand: typeof import('./JobDetailModule.js').briefFromCommand;

const ready = (async () => {
  ({ readFloorState } = await import('../../../lib/server/fleet/floorState.js'));
  ({ costFleetJob } = await import('../../../lib/server/fleet/jobCosts.js'));
  ({ formatJobDetail, formatElapsed, formatAge, briefFromCommand } = await import('./JobDetailModule.js'));
})();

const JOBS_ROOT = path.join(tmpHome, '.sam', 'jobs');

function jobDir(id: string): string {
  const dir = path.join(JOBS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMeta(id: string, meta: Record<string, unknown>): void {
  fs.writeFileSync(path.join(jobDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
}

function writeResultLog(id: string, result: Record<string, unknown>): void {
  // sam-job's own plain-text stdout.log: a line of CLI chatter either side of
  // the one JSON object readFrames/costFleetJob actually care about — same
  // shape jobCosts.ts's own doc comment describes.
  const text = [
    'Claude Code session starting…',
    JSON.stringify({ type: 'result', ...result }),
    'Session complete.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(jobDir(id), 'stdout.log'), text, 'utf-8');
}

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

test('formatJobDetail cost agrees with costFleetJob for the same fixture job (Must 15)', async () => {
  await ready;

  const id = 'job-cost-agreement';
  // sam-job-shaped meta.json (has `unit`, no `lastSeq`) with the Must 16a
  // `general` field set directly — no `fleet:` command convention needed for
  // the floor to group it under hephaestus. Still running (not 'done') so it
  // stays on the floor as a worker — `readFloorState` drops a finished job
  // from the workers list once it has "returned to SAM" (Must 11), but its
  // cost is read from the result event the same way either way.
  writeMeta(id, {
    id,
    command: 'claude -p "build the thing"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-300_000),
    startedAt: iso(-200_000),
    endedAt: null,
    outputBytes: 0,
    unit: 'sam-job-cost-agreement',
    notify: false,
    summary: null,
    general: 'hephaestus',
  });
  writeResultLog(id, {
    total_cost_usd: 0.1234,
    duration_ms: 190_000,
    session_id: 'sess-cost-agreement',
    usage: { input_tokens: 1000, cache_read_input_tokens: 200, output_tokens: 500 },
  });

  const state = await readFloorState();
  const worker = state.generals.hephaestus.workers.find((w) => w.jobId === id);
  assert.ok(worker, 'fixture job must appear under hephaestus');

  // The command never carries a `fleet:` prefix, so the dispatched model
  // string is empty — same as what floorState.ts itself derives for this
  // fixture (modelFromCommand returns '' when the command doesn't match).
  const directCost = await costFleetJob(id, '');

  assert.equal(directCost.costUsd, 0.1234, 'costFleetJob should read the result event verbatim (not DeepSeek)');
  assert.equal(worker!.costUsd, directCost.costUsd, 'the floor reader must cost the job the same way as a direct call');

  const view = formatJobDetail(worker!);
  assert.equal(view.cost, formatCost(directCost.costUsd!), 'formatJobDetail must display costFleetJob\'s own figure, not a recomputed one');
  assert.equal(view.cost, '$0.12');
});

test('formatJobDetail shows "unknown" cost when no result event exists yet', async () => {
  await ready;

  const id = 'job-no-result-yet';
  writeMeta(id, {
    id,
    command: 'claude -p "still running"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    outputBytes: 0,
    unit: 'sam-job-no-result',
    notify: false,
    summary: null,
    general: 'cerberus',
  });

  const state = await readFloorState();
  const worker = state.generals.cerberus.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  assert.equal(worker!.costUsd, null);

  const view = formatJobDetail(worker!);
  assert.equal(view.cost, 'unknown');
});

test('formatJobDetail reports "no stage data" for a job with no planned stages (Must 17)', async () => {
  await ready;

  const id = 'job-legacy-no-stages';
  writeMeta(id, {
    id,
    command: 'fleet:calliope (sonnet) — write ad copy',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    lastSeq: 1,
  });

  const state = await readFloorState();
  const worker = state.generals.calliope.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  assert.equal(worker!.stagesPlanned, null);

  const view = formatJobDetail(worker!);
  assert.equal(view.stagesLabel, 'no stage data');
});

test('formatJobDetail numbers the current stage (second running, first done reads "Stage 2 of 3")', async () => {
  await ready;

  const id = 'job-with-stages';
  writeMeta(id, {
    id,
    command: 'claude -p "plan, build, verify"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-60_000),
    startedAt: iso(-50_000),
    endedAt: null,
    unit: 'sam-job-with-stages',
    notify: false,
    summary: null,
    general: 'hermes',
  });
  fs.writeFileSync(
    path.join(jobDir(id), 'events.jsonl'),
    [
      { type: 'dispatched', at: iso(-60_000), stages: ['plan', 'build', 'verify'] },
      { type: 'started', at: iso(-50_000) },
      { type: 'stage-start', stage: 'plan', at: iso(-45_000) },
      { type: 'stage-done', stage: 'plan', at: iso(-40_000) },
      { type: 'stage-start', stage: 'build', at: iso(-30_000) },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
  );

  const state = await readFloorState();
  const worker = state.generals.hermes.workers.find((w) => w.jobId === id);
  assert.ok(worker);

  const view = formatJobDetail(worker!);
  assert.equal(view.stagesLabel, 'Stage 2 of 3');
});

test('formatJobDetail shows "unknown" name and tier when the worker has neither summary/tier nor a legacy fallback', async () => {
  await ready;

  const id = 'job-meta-fallback';
  writeMeta(id, {
    id,
    command: 'claude -p "tidy the vault"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
  });

  const state = await readFloorState();
  const worker = state.samWorkers.find((w) => w.jobId === id);
  assert.ok(worker, 'a job with no General and no fleet: command groups under sam');
  assert.equal(worker!.summary, null);
  assert.equal(worker!.tier, null);

  const bare = formatJobDetail(worker!);
  assert.equal(bare.name, 'unknown');
  assert.equal(bare.modelTier, 'unknown');
  assert.equal(bare.general, 'SAM');

  // An empty legacy lookup (no brief, no model) changes nothing.
  const emptyMeta = formatJobDetail(worker!, { name: null, modelTier: null });
  assert.equal(emptyMeta.name, 'unknown');
  assert.equal(emptyMeta.modelTier, 'unknown');
});

test('formatJobDetail resolves name/tier from the legacy fleet: fallback when the worker has no summary/tier (ux-fixes T35)', async () => {
  await ready;

  const id = 'job-legacy-fallback';
  const command = 'fleet:hermes (Sonnet) — draft the outreach list';
  writeMeta(id, {
    id,
    command,
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    lastSeq: 1,
  });

  const state = await readFloorState();
  const worker = state.generals.hermes.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  assert.equal(worker!.summary, null);
  assert.equal(worker!.tier, null);

  // The same shape the Fleet jobs lookup hands back: brief parsed from the
  // command, model from the job record.
  assert.equal(briefFromCommand(command), 'draft the outreach list');
  const view = formatJobDetail(worker!, { name: briefFromCommand(command), modelTier: 'Sonnet' });
  assert.equal(view.name, 'draft the outreach list');
  assert.equal(view.modelTier, 'Sonnet');
});

test('formatJobDetail: the worker\'s own summary/tier win over the legacy fallback (ux-fixes T35)', async () => {
  await ready;

  const id = 'job-new-fields-win';
  writeMeta(id, {
    id,
    command: 'fleet:hermes (Haiku) — old brief',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    unit: 'sam-job-new-fields-win',
    notify: false,
    summary: 'Real title',
    general: 'hermes',
    tier: 'opus',
  });

  const state = await readFloorState();
  const worker = state.generals.hermes.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  const view = formatJobDetail(worker!, { name: 'old brief', modelTier: 'Haiku' });
  assert.equal(view.name, 'Real title');
  assert.equal(view.modelTier, 'opus');

  // Partial: summary present, tier absent -> tier falls back, name does not.
  const partial = formatJobDetail({ ...worker!, tier: null }, { name: 'old brief', modelTier: 'Haiku' });
  assert.equal(partial.name, 'Real title');
  assert.equal(partial.modelTier, 'Haiku');
});

function stageWorker(id: string, events: Array<Record<string, unknown>>) {
  return (async () => {
    writeMeta(id, {
      id,
      command: 'claude -p "plan, build, verify"',
      status: 'running',
      exitCode: null,
      createdAt: iso(-60_000),
      startedAt: iso(-50_000),
      endedAt: null,
      unit: `sam-job-${id}`,
      notify: false,
      summary: null,
      general: 'hermes',
    });
    fs.writeFileSync(
      path.join(jobDir(id), 'events.jsonl'),
      events.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    const state = await readFloorState();
    const worker = state.generals.hermes.workers.find((w) => w.jobId === id);
    assert.ok(worker);
    return worker!;
  })();
}

test('formatJobDetail reads "Stage 1 of 3" as soon as the first stage is running (check 3)', async () => {
  await ready;
  const worker = await stageWorker('job-stage-first-running', [
    { type: 'dispatched', at: iso(-60_000), stages: ['plan', 'build', 'verify'] },
    { type: 'started', at: iso(-50_000) },
    { type: 'stage-start', stage: 'plan', at: iso(-2_000) },
  ]);
  assert.equal(formatJobDetail(worker).stagesLabel, 'Stage 1 of 3');
});

test('formatJobDetail reads "Stage 3 of 3" once every stage is done', async () => {
  await ready;
  const worker = await stageWorker('job-stage-all-done', [
    { type: 'dispatched', at: iso(-60_000), stages: ['plan', 'build', 'verify'] },
    { type: 'started', at: iso(-50_000) },
    { type: 'stage-start', stage: 'plan', at: iso(-45_000) },
    { type: 'stage-done', stage: 'plan', at: iso(-40_000) },
    { type: 'stage-start', stage: 'build', at: iso(-35_000) },
    { type: 'stage-done', stage: 'build', at: iso(-30_000) },
    { type: 'stage-start', stage: 'verify', at: iso(-25_000) },
    { type: 'stage-done', stage: 'verify', at: iso(-20_000) },
  ]);
  assert.equal(formatJobDetail(worker).stagesLabel, 'Stage 3 of 3');
});

test('formatJobDetail resolves a real title and tier from the worker\'s own summary/tier fields (ux-fixes T8, must-do 1/2)', async () => {
  await ready;

  const id = 'job-sam-dispatch-shaped';
  // A sam-dispatch-shaped job: no `fleet:<persona> (<model>) — <brief>`
  // command convention at all (the exact shape that fell through to
  // "unknown" before T8) — `summary`/`tier`/`general` set directly, the way
  // live `sam-job --summary` and staged `sam-job.next --tier` write them.
  writeMeta(id, {
    id,
    command: 'claude -p "build the thing" --model sonnet',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    unit: 'sam-job-sam-dispatch-shaped',
    notify: false,
    summary: 'Build the thing',
    general: 'hephaestus',
    tier: 'sonnet',
  });

  const state = await readFloorState();
  const worker = state.generals.hephaestus.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  assert.equal(worker!.summary, 'Build the thing');
  assert.equal(worker!.tier, 'sonnet');

  const view = formatJobDetail(worker!);
  assert.equal(view.name, 'Build the thing');
  assert.equal(view.modelTier, 'sonnet');
});

test('formatJobDetail renders a "Last:" line from the worker\'s lastAction (T7), aged in plain relative time', async () => {
  await ready;

  const id = 'job-with-last-action';
  writeMeta(id, {
    id,
    command: 'claude -p "plan, build, verify"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-180_000),
    startedAt: iso(-170_000),
    endedAt: null,
    unit: 'sam-job-with-last-action',
    notify: false,
    summary: null,
    general: 'hermes',
  });
  fs.writeFileSync(
    path.join(jobDir(id), 'events.jsonl'),
    [
      { type: 'dispatched', at: iso(-180_000), stages: ['plan', 'build'] },
      { type: 'started', at: iso(-170_000) },
      { type: 'action', at: iso(-120_000), description: 'Read the brief' },
      { type: 'action', at: iso(-60_000), description: 'Wrote the draft' },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
  );

  const state = await readFloorState();
  const worker = state.generals.hermes.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  assert.deepEqual(worker!.lastAction, { description: 'Wrote the draft', at: iso(-60_000) });

  const view = formatJobDetail(worker!);
  assert.equal(view.last, 'Last: Wrote the draft · 1 min ago');
  assert.ok(!/\d{2}:\d{2}/.test(view.last!), 'no mm:ss in the age');
});

test('formatJobDetail omits the "Last:" line (null, never "unknown") when no action event exists', async () => {
  await ready;

  const id = 'job-no-action-yet';
  writeMeta(id, {
    id,
    command: 'claude -p "no actions logged yet"',
    status: 'running',
    exitCode: null,
    createdAt: iso(-20_000),
    startedAt: iso(-10_000),
    endedAt: null,
    unit: 'sam-job-no-action-yet',
    notify: false,
    summary: null,
    general: 'prometheus',
  });

  const state = await readFloorState();
  const worker = state.generals.prometheus.workers.find((w) => w.jobId === id);
  assert.ok(worker);
  assert.equal(worker!.lastAction, null);

  const view = formatJobDetail(worker!);
  assert.equal(view.last, null);
});

test('formatElapsed renders mm:ss under an hour and h:mm:ss past it', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(65_000), '01:05');
  assert.equal(formatElapsed(3_661_000), '1:01:01');
});

test('formatAge renders plain relative time: seconds, minutes, hours (no mm:ss)', () => {
  assert.equal(formatAge(40_000), '40 s');
  assert.equal(formatAge(5 * 60_000 + 6_000), '5 min');
  assert.equal(formatAge(2 * 3_600_000 + 10 * 60_000), '2 h');
  assert.equal(formatAge(-5_000), '0 s');
});

test('formatJobDetail "Last:" line reads "40 s ago" / "5 min ago" / "2 h ago"', async () => {
  await ready;
  const base = Date.parse('2026-10-04T12:00:00.000Z');
  const mk = (ageMs: number) =>
    formatJobDetail(
      {
        jobId: 'j', general: 'hermes', status: 'running', elapsedMs: 0, costUsd: null,
        summary: null, tier: null, stages: null, stagesPlanned: null,
        lastAction: { description: 'Ran tests', at: new Date(base - ageMs).toISOString() },
      } as unknown as Parameters<typeof formatJobDetail>[0],
      null,
      base,
    ).last;
  assert.equal(mk(40_000), 'Last: Ran tests · 40 s ago');
  assert.equal(mk(5 * 60_000 + 6_000), 'Last: Ran tests · 5 min ago');
  assert.equal(mk(2 * 3_600_000), 'Last: Ran tests · 2 h ago');
});
