/**
 * SAM — sam-dispatch brief validation: `General:` and `Stages:` lines
 * (staged, visual-upgrade T2).
 *
 * Spec: must-do 16, 16a; check 10. `sam-dispatch` must refuse a brief
 * missing either line, or naming an unknown General, the same way it
 * refuses a missing `Task type:` today. A good brief must pass the parsed
 * General and Stages through to `sam-job` as `--general <name>` and
 * `--stages "<a>,<b>,..."`.
 *
 * This is a brief-validation test only — it never reaches the real job
 * pipeline. `SAM_JOB_BIN` always points at a stub script (built fresh per
 * case in a temp dir) that just records its argv to a file and exits 0, and
 * `SAM_DISPATCH_LOG` always points at a temp file. No case here can start a
 * real `claude -p`, launch a real systemd unit, or write the live dispatch
 * log — whichever binary is under test.
 *
 * Binary selection (T2 foreman's note): `SAM_DISPATCH_BIN` env override if
 * set, else `sam-dispatch.next` if present, else the live `sam-dispatch` —
 * so this test still holds once T23 installs `.next` and retires it.
 *
 * BOX-ONLY: the resolved binary lives under `/home/col/.local/bin`, which
 * exists only on Colin's box. On a GitHub-hosted runner this reports
 * SKIPPED with its reason (see boxOnly.ts) rather than failing for a reason
 * unrelated to the code under test.
 *
 * T2's own before/after proof: run once with
 * `SAM_DISPATCH_BIN=/home/col/.local/bin/sam-dispatch` (the live file, no
 * General/Stages check yet) — the first two cases below fail. Run again
 * with no override (default resolves `.next`) — all three pass.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';

function stagedOrLive(staged: string, live: string): string {
  return fs.existsSync(staged) ? staged : live;
}

const DISPATCH_BIN =
  process.env.SAM_DISPATCH_BIN ||
  stagedOrLive('/home/col/.local/bin/sam-dispatch.next', '/home/col/.local/bin/sam-dispatch');

const SKIP = boxOnlySkip('the real sam-dispatch (or its staged .next copy)', [DISPATCH_BIN]);

interface Ctx {
  tmp: string;
  cwd: string;
  jobBin: string;
  argvFile: string;
  dispatchLog: string;
}

/** A fresh temp sandbox per case: its own cwd, stub sam-job and dispatch log. */
function makeCtx(): Ctx {
  const tmp = tempDir('dispatch-brief-');
  const cwd = path.join(tmp, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  const argvFile = path.join(tmp, 'argv.txt');
  const jobBin = path.join(tmp, 'stub-job');
  // Records its argv (one token per line, via $ARGV_FILE) and exits 0 — this
  // is the ONLY thing sam-dispatch's exec line can reach in this test.
  fs.writeFileSync(
    jobBin,
    '#!/bin/sh\n: > "$ARGV_FILE"\nfor a in "$@"; do printf \'%s\\n\' "$a" >> "$ARGV_FILE"; done\nexit 0\n',
  );
  fs.chmodSync(jobBin, 0o755);
  return { tmp, cwd, jobBin, argvFile, dispatchLog: path.join(tmp, 'dispatch.log') };
}

function runDispatch(
  ctx: Ctx,
  brief: string,
  name: string,
): { status: number | null; stderr: string } {
  const briefFile = path.join(ctx.tmp, name + '.md');
  fs.writeFileSync(briefFile, brief);
  const r = spawnSync(
    DISPATCH_BIN,
    ['--tier', 'sonnet', '--brief', briefFile, '--cwd', ctx.cwd, '--name', name],
    {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        // sam-dispatch execs the job, so it never removes its mktemp work copy of the brief; keep it in the sandbox.
        TMPDIR: ctx.tmp,
        // The seat guard must not read the box's real quota file (2026-10-08: max2 at 101% failed a deploy).
        SAM_QUOTA_RUNS: path.join(os.tmpdir(), 'no-quota.jsonl'),
        SAM_JOB_BIN: ctx.jobBin,
        SAM_DISPATCH_LOG: ctx.dispatchLog,
        ARGV_FILE: ctx.argvFile,
      },
    },
  );
  return { status: r.status, stderr: r.stderr ?? '' };
}

test('a brief with Task type but no General is refused', { skip: SKIP }, () => {
  const ctx = makeCtx();
  const r = runDispatch(ctx, 'Task type: build\nDo the thing.\n', 'no-general');
  assert.notEqual(r.status, 0, `expected refusal, got status ${r.status}: ${r.stderr}`);
  assert.ok(!fs.existsSync(ctx.argvFile), 'the stub job must never be invoked');
});

test('a brief naming an unknown General is refused', { skip: SKIP }, () => {
  const ctx = makeCtx();
  const r = runDispatch(
    ctx,
    'Task type: build\nGeneral: pluto\nStages: Scan, Report\n',
    'unknown-general',
  );
  assert.notEqual(r.status, 0, `expected refusal, got status ${r.status}: ${r.stderr}`);
  assert.ok(!fs.existsSync(ctx.argvFile), 'the stub job must never be invoked');
});

test('a good brief passes General and Stages through to sam-job', { skip: SKIP }, () => {
  const ctx = makeCtx();
  const r = runDispatch(
    ctx,
    'Task type: build\nGeneral: cerberus\nStages: Scan, Report\n',
    'good-brief',
  );
  assert.equal(r.status, 0, `expected success, got status ${r.status}: ${r.stderr}`);
  assert.ok(fs.existsSync(ctx.argvFile), 'the stub job must be invoked');
  const argv = fs
    .readFileSync(ctx.argvFile, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const generalIdx = argv.indexOf('--general');
  assert.ok(generalIdx !== -1, `argv must include --general: ${argv.join(' ')}`);
  assert.equal(argv[generalIdx + 1], 'cerberus');
  const stagesIdx = argv.indexOf('--stages');
  assert.ok(stagesIdx !== -1, `argv must include --stages: ${argv.join(' ')}`);
  assert.equal(argv[stagesIdx + 1], 'Scan,Report');
});
