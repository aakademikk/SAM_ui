/**
 * SAM — `PostToolUse` job-action-logger hook is a no-op outside a job's own
 * worker run, and never writes raw command text (staged, ux-fixes T6).
 *
 * Spec: must-do 5; check 4. `job-action-logger.next.sh`
 * (`/home/col/.claude/hooks/job-action-logger.next.sh`) is a staged `.next`
 * hook script, not yet installed into either seat's `settings.json` — see
 * `implementation/job-action-logger.settings-snippet.json` for the paste-in
 * snippet and install note. This test invokes the staged script directly via
 * `child_process`, feeding it the same tool-call JSON shape Claude Code
 * itself would pipe to a `PostToolUse` hook on stdin — it never needs the
 * harness itself running, matching how `samDispatchStageInstruction.test.ts`
 * exercises `sam-dispatch.next` directly.
 *
 * No box-only guard: this is a pure bash script with no systemd dependency
 * (unlike `sam-dispatch`/`sam-job`, which need a real unit to run jobs
 * against) — it only needs `bash` and `jq`, both already relied on by the
 * hook scripts this repo's other tests exercise indirectly.
 *
 * Three cases, each a fresh temp sandbox:
 *   (a) neither SAM_JOB_EVENTS nor SAM_JOB_DIR set (Colin's ordinary
 *       interactive session) -> the script exits 0 and never creates (or
 *       touches) the target events file.
 *   (b) SAM_JOB_EVENTS (and separately, SAM_JOB_DIR) set to a temp path,
 *       stdin a Bash tool call whose tool_input carries both `description:
 *       "Run the acceptance suite"` and `command: "echo FAKE_TOKEN_abc123"`
 *       -> the appended line's `description` is exactly "Run the acceptance
 *       suite", and the events file never contains the substring
 *       "FAKE_TOKEN_abc123" anywhere — the planted-token proof that the raw
 *       command text never reaches the file (must-do 5's "never include
 *       tool_input.command" clause, check 4).
 *   (c) a `description` longer than 120 characters is truncated to exactly
 *       120 in the appended line.
 *
 * Never touches live state: every case runs against its own fresh temp
 * directory and a path override passed as an argv/env seam, never
 * `~/.sam/jobs` or a real job's `events.jsonl`. `FAKE_TOKEN_abc123` is a
 * synthetic planted token, not a real credential.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from '@/lib/server/testing/tempDir';

const SCRIPT =
  process.env.SAM_JOB_ACTION_LOGGER_UNDER_TEST ||
  '/home/col/.claude/hooks/job-action-logger.next.sh';

/** A fresh temp sandbox per case, holding only this case's events file. */
function makeTmp(): string {
  return tempDir('job-action-logger-');
}

/** Runs the hook script with crafted stdin JSON and an explicit env, always
 * stripping SAM_JOB_EVENTS/SAM_JOB_DIR from the inherited environment first
 * so a case that wants neither set can't accidentally inherit one from the
 * outer test-runner process. */
function runHook(
  payload: unknown,
  envOverrides: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SAM_JOB_EVENTS;
  delete env.SAM_JOB_DIR;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const r = spawnSync('bash', [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
    env,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function bashPayload(description: string, command: string): unknown {
  return {
    tool_name: 'Bash',
    tool_input: { description, command },
  };
}

function readJsonLines(file: string): Array<{ type: string; at: string; description: string }> {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test('neither SAM_JOB_EVENTS nor SAM_JOB_DIR set: no-op, events file untouched', () => {
  const tmp = makeTmp();
  const eventsFile = path.join(tmp, 'events.jsonl');
  fs.writeFileSync(eventsFile, 'PREEXISTING\n');
  const statBefore = fs.statSync(eventsFile);
  const contentsBefore = fs.readFileSync(eventsFile, 'utf8');

  const r = runHook(bashPayload('Run the acceptance suite', 'echo FAKE_TOKEN_abc123'), {});

  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  const statAfter = fs.statSync(eventsFile);
  const contentsAfter = fs.readFileSync(eventsFile, 'utf8');
  assert.equal(contentsAfter, contentsBefore, 'pre-existing events file must be byte-for-byte untouched');
  assert.equal(statAfter.mtimeMs, statBefore.mtimeMs, 'pre-existing events file mtime must be untouched');

  // And when the target doesn't exist at all yet, the no-op case must not
  // create it either.
  const neverCreated = path.join(tmp, 'never-created-events.jsonl');
  const r2 = runHook(bashPayload('Run the acceptance suite', 'echo FAKE_TOKEN_abc123'), {});
  assert.equal(r2.status, 0, `expected exit 0, got ${r2.status}: ${r2.stderr}`);
  assert.ok(!fs.existsSync(neverCreated), 'no-op must never create a fresh events file');
});

test(
  'SAM_JOB_EVENTS (and SAM_JOB_DIR) set: appends description only, never the planted command text',
  () => {
    const plantedToken = 'FAKE_TOKEN_abc123';
    const payload = bashPayload('Run the acceptance suite', `echo ${plantedToken}`);

    // Variant 1: SAM_JOB_EVENTS points straight at the target file.
    const tmp1 = makeTmp();
    const eventsFile1 = path.join(tmp1, 'events.jsonl');
    const r1 = runHook(payload, { SAM_JOB_EVENTS: eventsFile1 });
    assert.equal(r1.status, 0, `expected exit 0, got ${r1.status}: ${r1.stderr}`);
    const raw1 = fs.readFileSync(eventsFile1, 'utf8');
    assert.ok(!raw1.includes(plantedToken), `events file must never contain the planted token: ${raw1}`);
    const lines1 = readJsonLines(eventsFile1);
    assert.equal(lines1.length, 1, `expected exactly one appended line: ${raw1}`);
    assert.equal(lines1[0].type, 'action');
    assert.equal(lines1[0].description, 'Run the acceptance suite');
    assert.ok(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(lines1[0].at),
      `expected an ISO8601 UTC timestamp, got: ${lines1[0].at}`,
    );

    // Variant 2: SAM_JOB_DIR is set instead, falling back to
    // "$SAM_JOB_DIR/events.jsonl" per the hook's own documented fallback.
    const tmp2 = makeTmp();
    const r2 = runHook(payload, { SAM_JOB_DIR: tmp2 });
    assert.equal(r2.status, 0, `expected exit 0, got ${r2.status}: ${r2.stderr}`);
    const eventsFile2 = path.join(tmp2, 'events.jsonl');
    const raw2 = fs.readFileSync(eventsFile2, 'utf8');
    assert.ok(!raw2.includes(plantedToken), `events file must never contain the planted token: ${raw2}`);
    const lines2 = readJsonLines(eventsFile2);
    assert.equal(lines2.length, 1, `expected exactly one appended line: ${raw2}`);
    assert.equal(lines2[0].description, 'Run the acceptance suite');
  },
);

test('a description longer than 120 characters is truncated to exactly 120', () => {
  const longDescription = 'X'.repeat(150);
  assert.equal(longDescription.length, 150);
  const payload = bashPayload(longDescription, 'echo FAKE_TOKEN_abc123');

  const tmp = makeTmp();
  const eventsFile = path.join(tmp, 'events.jsonl');
  const r = runHook(payload, { SAM_JOB_EVENTS: eventsFile });

  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  const lines = readJsonLines(eventsFile);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description.length, 120, `expected truncation to 120 chars, got: ${lines[0].description}`);
  assert.equal(lines[0].description, longDescription.slice(0, 120));
});
