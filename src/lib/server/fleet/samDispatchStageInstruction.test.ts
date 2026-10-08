/**
 * SAM — `sam-dispatch` appends the stage-call instruction to every brief
 * (staged, ux-fixes T5).
 *
 * Spec: must-do 4. `sam-dispatch` already validates that a brief has
 * `General:`/`Stages:` lines (`sam-dispatch:102-110`) but never told the
 * worker to actually call `sam-stage start <stage>` / `sam-stage done
 * <stage>` as it moved through them — the audit's example: 16 tickets in,
 * still "Stage 0 of 2". This ticket makes `sam-dispatch` build a working
 * copy of the brief (`WORKBRIEF=$(mktemp)`), append a "Stage discipline"
 * instruction naming the exact planned stages, and point the exec line at
 * that copy instead of the original `$BRIEF` file, which is never mutated.
 *
 * This is a brief-resolution test only — it never reaches the real job
 * pipeline. `SAM_JOB_BIN` always points at a stub script (built fresh per
 * case in a temp dir) that records its invocation's resolved command string
 * (the `bash -c "..."` argument sam-dispatch's exec line builds) to a file
 * and exits 0 without running anything — so the test can read back the
 * `cat <workbrief-path>` the exec line would have run, resolve that path,
 * and inspect the brief text sam-dispatch actually built, without a real
 * worker or `claude -p` ever running.
 *
 * Binary selection follows the pattern `samDispatchBrief.test.ts` and
 * `samDispatchTier.test.ts` already use: `SAM_DISPATCH_BIN_UNDER_TEST` env
 * override if set, else `sam-dispatch.next` if present, else the live
 * `sam-dispatch` — so this test still holds once a later ticket installs
 * `.next` and retires it, and is reproducible both ways:
 *   - before (fails): `SAM_DISPATCH_BIN_UNDER_TEST=/home/col/.local/bin/sam-dispatch
 *     npm test src/lib/server/fleet/samDispatchStageInstruction.test.ts` —
 *     the live `sam-dispatch` passes `$BRIEF` straight through
 *     (`sam-dispatch:140`), so the resolved brief text carries no
 *     "sam-stage start"/"sam-stage done" instruction at all.
 *   - after (passes): plain `npm test
 *     src/lib/server/fleet/samDispatchStageInstruction.test.ts` — resolves
 *     `sam-dispatch.next`, which appends the instruction to a working copy
 *     and points the exec line there.
 *
 * BOX-ONLY: the resolved binary lives under `/home/col/.local/bin`, which
 * exists only on Colin's box. On a GitHub-hosted runner this reports
 * SKIPPED with its reason (see boxOnly.ts) rather than failing for a reason
 * unrelated to the code under test.
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
  process.env.SAM_DISPATCH_BIN_UNDER_TEST ||
  stagedOrLive('/home/col/.local/bin/sam-dispatch.next', '/home/col/.local/bin/sam-dispatch');

const SKIP = boxOnlySkip('the real sam-dispatch (or its staged .next copy)', [DISPATCH_BIN]);

interface Ctx {
  tmp: string;
  cwd: string;
  jobBin: string;
  cmdFile: string;
  dispatchLog: string;
}

/** A fresh temp sandbox per case: its own cwd, stub sam-job and dispatch log. */
function makeCtx(): Ctx {
  const tmp = tempDir('dispatch-stage-instr-');
  const cwd = path.join(tmp, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  const cmdFile = path.join(tmp, 'resolved-cmd.txt');
  const jobBin = path.join(tmp, 'stub-job');
  // Records argv, one token per line, so the test can pull out the trailing
  // `bash -c "<resolved command string>"` sam-dispatch's exec line built —
  // this is the ONLY thing sam-dispatch's exec line can reach in this test.
  fs.writeFileSync(
    jobBin,
    '#!/bin/sh\n: > "$CMD_FILE"\nfor a in "$@"; do printf \'%s\\n\' "$a" >> "$CMD_FILE"; done\nexit 0\n',
  );
  fs.chmodSync(jobBin, 0o755);
  return { tmp, cwd, jobBin, cmdFile, dispatchLog: path.join(tmp, 'dispatch.log') };
}

/** Runs sam-dispatch against a fixture brief, returning its exit status and
 * the resolved `bash -c` command string the stub sam-job recorded (or null
 * if the stub was never invoked). */
function runDispatch(
  ctx: Ctx,
  brief: string,
  name: string,
): { status: number | null; stderr: string; resolvedCmd: string | null } {
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
        CMD_FILE: ctx.cmdFile,
      },
    },
  );
  let resolvedCmd: string | null = null;
  if (fs.existsSync(ctx.cmdFile)) {
    const argv = fs
      .readFileSync(ctx.cmdFile, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    // argv is: --notify --name ... --tier sonnet -- bash -c "<resolved cmd>"
    resolvedCmd = argv[argv.length - 1] ?? null;
  }
  return { status: r.status, stderr: r.stderr ?? '', resolvedCmd };
}

/** Resolves the brief text the exec line would actually `cat`, by pulling
 * the `cat <path>` target out of the resolved `bash -c` command string and
 * reading it from disk. */
function resolveBriefTextFromCommand(resolvedCmd: string): string {
  // The resolved command wraps the `cat` call as `"$(cat <path>)"` — an
  // unquoted path (the common case for a plain mktemp path with no shell
  // metacharacters) is followed immediately by `)"` with no space, so the
  // unquoted alternative below must stop before `)` as well as whitespace.
  const match = /cat\s+('([^']*)'|"([^"]*)"|([^\s)]+))/.exec(resolvedCmd);
  assert.ok(match, `resolved command has no 'cat <path>': ${resolvedCmd}`);
  const workbriefPath = match[2] ?? match[3] ?? match[4];
  assert.ok(workbriefPath, `could not extract workbrief path from: ${resolvedCmd}`);
  return fs.readFileSync(workbriefPath, 'utf8');
}

test(
  'a good brief gets the stage-discipline instruction appended, naming its planned stages',
  { skip: SKIP },
  () => {
    const ctx = makeCtx();
    const originalBrief = [
      'Task type: build',
      'General: cerberus',
      'Stages: Scan, Report',
      '',
      'Run the acceptance suite against the bad fixture.',
      '',
    ].join('\n');
    const briefFile = path.join(ctx.tmp, 'stage-instr.md');
    fs.writeFileSync(briefFile, originalBrief);
    const statBefore = fs.statSync(briefFile);
    const contentsBefore = fs.readFileSync(briefFile, 'utf8');

    const r = spawnSync(
      DISPATCH_BIN,
      ['--tier', 'sonnet', '--brief', briefFile, '--cwd', ctx.cwd, '--name', 'stage-instr'],
      {
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          TMPDIR: ctx.tmp,
          // The seat guard must not read the box's real quota file (2026-10-08: max2 at 101% failed a deploy).
          SAM_QUOTA_RUNS: path.join(os.tmpdir(), 'no-quota.jsonl'),
          SAM_JOB_BIN: ctx.jobBin,
          SAM_DISPATCH_LOG: ctx.dispatchLog,
          CMD_FILE: ctx.cmdFile,
        },
      },
    );
    assert.equal(r.status, 0, `expected success, got status ${r.status}: ${r.stderr}`);
    assert.ok(fs.existsSync(ctx.cmdFile), 'the stub job must be invoked');

    const argv = fs
      .readFileSync(ctx.cmdFile, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    const resolvedCmd = argv[argv.length - 1];
    assert.ok(resolvedCmd, `expected a resolved bash -c command, got argv: ${argv.join(' ')}`);

    const resolvedBriefText = resolveBriefTextFromCommand(resolvedCmd);

    // The resolved brief carries both stage names and the literal
    // sam-stage call phrases.
    assert.ok(
      resolvedBriefText.includes('Scan'),
      `resolved brief must name stage "Scan": ${resolvedBriefText}`,
    );
    assert.ok(
      resolvedBriefText.includes('Report'),
      `resolved brief must name stage "Report": ${resolvedBriefText}`,
    );
    assert.ok(
      resolvedBriefText.includes('sam-stage start'),
      `resolved brief must contain the literal phrase "sam-stage start": ${resolvedBriefText}`,
    );
    assert.ok(
      resolvedBriefText.includes('sam-stage done'),
      `resolved brief must contain the literal phrase "sam-stage done": ${resolvedBriefText}`,
    );

    // The resolved brief is a WORKING COPY, not the original file path.
    const resolvedPathMatch = /cat\s+('([^']*)'|"([^"]*)"|([^\s)]+))/.exec(resolvedCmd);
    const resolvedPath = resolvedPathMatch?.[2] ?? resolvedPathMatch?.[3] ?? resolvedPathMatch?.[4];
    assert.ok(resolvedPath, `could not extract resolved path from: ${resolvedCmd}`);
    assert.notEqual(
      fs.realpathSync(resolvedPath as string),
      fs.realpathSync(briefFile),
      'the exec line must read a working copy, never the original $BRIEF path',
    );

    // The ORIGINAL $BRIEF file on disk is byte-for-byte unchanged — never
    // mutated in place.
    const statAfter = fs.statSync(briefFile);
    const contentsAfter = fs.readFileSync(briefFile, 'utf8');
    assert.equal(contentsAfter, contentsBefore, 'original brief contents must be untouched');
    assert.equal(statAfter.mtimeMs, statBefore.mtimeMs, 'original brief mtime must be untouched');
  },
);

test('a brief with no General is still refused (validation logic untouched)', { skip: SKIP }, () => {
  const ctx = makeCtx();
  const r = runDispatch(ctx, 'Task type: build\nDo the thing.\n', 'no-general');
  assert.notEqual(r.status, 0, `expected refusal, got status ${r.status}: ${r.stderr}`);
  assert.ok(!fs.existsSync(ctx.cmdFile), 'the stub job must never be invoked');
});
