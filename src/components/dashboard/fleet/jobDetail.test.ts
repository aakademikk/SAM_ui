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

const ready = (async () => {
  ({ readFloorState } = await import('../../../lib/server/fleet/floorState.js'));
  ({ costFleetJob } = await import('../../../lib/server/fleet/jobCosts.js'));
  ({ formatJobDetail, formatElapsed } = await import('./JobDetailModule.js'));
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

test('formatJobDetail counts stages done out of planned, in event order (Must 14)', async () => {
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
  assert.equal(view.stagesLabel, '1 / 3');
});

test('formatJobDetail falls back to "unknown" name and model tier with no resolved meta, and uses meta when given', async () => {
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

  const bare = formatJobDetail(worker!);
  assert.equal(bare.name, 'unknown');
  assert.equal(bare.modelTier, 'unknown');
  assert.equal(bare.general, 'SAM');

  const withMeta = formatJobDetail(worker!, { name: 'Tidy the vault', modelTier: 'sonnet' });
  assert.equal(withMeta.name, 'Tidy the vault');
  assert.equal(withMeta.modelTier, 'sonnet');
});

test('formatElapsed renders mm:ss under an hour and h:mm:ss past it', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(65_000), '01:05');
  assert.equal(formatElapsed(3_661_000), '1:01:01');
});
