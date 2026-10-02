/**
 * SAM — a job dispatched from a chat pings that chat (staged).
 *
 * Spec: must-do 16; check 11. `sam-dispatch` execs `sam-job`, which starts
 * `run.sh` as a `systemd-run --user` service unit. The unit does not inherit
 * the caller's env, so `SAM_CHAT_ID` never reaches `run.sh` on its own:
 * `sam-job` records it in the job's `meta.json` at launch and `run.sh` links
 * the finish ping to `/chat?c=<chatId>`.
 *
 * This runs the STAGED copies (`sam-dispatch.next`, `sam-job.next`,
 * `run.next.sh`, `send.next.mjs`) when they exist, else the live files, so it
 * still holds once T21 installs them.
 *
 * BOX-ONLY: all four of those live under `/home/col`, so on a GitHub-hosted
 * runner there is nothing to run and the test reports SKIPPED with its reason
 * (see boxOnly.ts). It runs in full on the box, where ./deploy.sh gates on
 * the suite.
 *
 * It never touches live state:
 *   - `SAM_JOB_STORE` is a temp dir, so the job's files never land in
 *     `~/.sam/jobs`;
 *   - `SAM_PUSH_SUBS` is a temp file holding `[]` and `SAM_PUSH_LOG` a temp
 *     path. `sam-job` hands both (and `SAM_PUSH_BIN`) to the unit with
 *     `--setenv`, which matters: the unit runs with Colin's real `HOME`, so
 *     without them `sam-push` would read his real subscriber list and send a
 *     real push. With `[]` it logs the ping and exits 0 ("no subscribers").
 *
 * The job itself is one real Haiku call through `sam-dispatch`'s normal path
 * (the seat it picks, the tier-to-model table). If that seat is at its limit
 * the job fails fast, the ping still fires (with the failure title), and the
 * link assertion still holds.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { boxOnlySkip } from '@/lib/server/testing/boxOnly';

function stagedOrLive(staged: string, live: string): string {
  return fs.existsSync(staged) ? staged : live;
}

const DISPATCH_BIN = stagedOrLive(
  '/home/col/.local/bin/sam-dispatch.next',
  '/home/col/.local/bin/sam-dispatch',
);
const JOB_BIN = stagedOrLive('/home/col/.local/bin/sam-job.next', '/home/col/.local/bin/sam-job');
const RUN_SH = stagedOrLive('/home/col/.sam/sam-job/run.next.sh', '/home/col/.sam/sam-job/run.sh');
const PUSH_BIN = stagedOrLive('/home/col/.sam/sam-push/send.next.mjs', '/home/col/.local/bin/sam-push');

/* false on the box; a reason string on a hosted runner, where none of the
 * four resolved paths exist and the spawn at the top of the test would fail
 * with `status: null` rather than reaching any assertion. See boxOnly.ts. */
const SKIP = boxOnlySkip('the real sam-dispatch, sam-job, run.sh and sam-push', [
  DISPATCH_BIN,
  JOB_BIN,
  RUN_SH,
  PUSH_BIN,
]);

const TIMEOUT_MS = 180_000;
const CHAT_ID = '3f2a9c1e-7b4d-4e8a-9c6f-0d1e2f3a4b5c';

interface JobMeta {
  id: string;
  status: string;
  chatId?: string | null;
}

interface LoggedPing {
  url: string;
  chatId: string | null;
  jobId: string | null;
  title: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test(
  'a job dispatched from chat X ends with a ping linked to /chat?c=X',
  { skip: SKIP, timeout: TIMEOUT_MS + 20_000 },
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ping-'));
    const store = path.join(tmp, 'jobs');
    const cwd = path.join(tmp, 'cwd');
    const brief = path.join(tmp, 'brief.md');
    const subsFile = path.join(tmp, 'push-subs.json');
    const logFile = path.join(tmp, 'push-log.jsonl');
    fs.mkdirSync(store, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(brief, 'Reply with the single word OK.\n');
    fs.writeFileSync(subsFile, '[]');

    const r = spawnSync(
      DISPATCH_BIN,
      ['--tier', 'haiku', '--brief', brief, '--cwd', cwd, '--name', 'mc-ping-test'],
      {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          SAM_CHAT_ID: CHAT_ID,
          SAM_JOB_STORE: store,
          SAM_JOB_BIN: JOB_BIN,
          SAM_JOB_RUN_SH: RUN_SH,
          SAM_PUSH_BIN: PUSH_BIN,
          SAM_PUSH_SUBS: subsFile,
          SAM_PUSH_LOG: logFile,
        },
      },
    );
    assert.equal(r.status, 0, `sam-dispatch failed: ${r.stderr}`);

    const jobs = fs.readdirSync(store);
    assert.equal(jobs.length, 1, 'exactly one job in the temp store');
    const jobId = jobs[0];
    const metaFile = path.join(store, jobId, 'meta.json');

    // Poll until the worker records the outcome.
    const deadline = Date.now() + TIMEOUT_MS;
    let meta: JobMeta | null = null;
    while (Date.now() < deadline) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as JobMeta;
      } catch {
        meta = null; // mid-write; try again
      }
      if (meta && (meta.status === 'exited' || meta.status === 'failed')) break;
      await sleep(1_000);
    }
    assert.ok(
      meta && (meta.status === 'exited' || meta.status === 'failed'),
      `job ${jobId} did not finish within ${TIMEOUT_MS / 1000} s (status ${meta?.status})`,
    );
    assert.equal(meta.chatId, CHAT_ID);

    // The ping is sent after the final meta write; give it a moment to land.
    let lines: LoggedPing[] = [];
    const pingDeadline = Date.now() + 15_000;
    while (Date.now() < pingDeadline) {
      if (fs.existsSync(logFile)) {
        lines = fs
          .readFileSync(logFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as LoggedPing);
        if (lines.length > 0) break;
      }
      await sleep(500);
    }
    assert.equal(lines.length, 1, 'exactly one ping logged');
    assert.equal(lines[0].url, '/chat?c=' + CHAT_ID);
    assert.equal(lines[0].chatId, CHAT_ID);
    assert.equal(lines[0].jobId, jobId);
  },
);
